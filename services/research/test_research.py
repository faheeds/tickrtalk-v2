import importlib
import json
import os
import tempfile
import threading
import time
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from reports import build_report, coverage_warnings
import server

class ReportTests(unittest.TestCase):
    def test_provider_failures_remain_visible_without_exposing_private_logs(self):
        warnings = coverage_warnings("Reddit RSS fetch failed for r/stocks: HTTP 429\nOptional macro_data unavailable for get_macro_indicators\nVendor 'yfinance' failed for get_stock_data: private-details")
        self.assertEqual(len(warnings), 3)
        self.assertTrue(any("Social-source coverage is incomplete" in warning for warning in warnings))
        self.assertNotIn("private-details", " ".join(warnings))
        self.assertEqual(coverage_warnings("Normal successful run"), [])
    def test_original_reports_and_qualification(self):
        state = {"fundamentals_report": "Revenue claim [filing](https://example.com/filing)",
                 "market_report": "RSI **test**", "investment_plan": "Original conclusion",
                 "investment_debate_state": {"bull_history": "Bull", "bear_history": "Bear"},
                 "risk_debate_state": {"neutral_history": "Balanced"}, "final_trade_decision": "Original decision"}
        report = build_report(state, "AAPL", "2026-10-13", {"commit": "test"})
        self.assertEqual(report["sections"]["fundamentals"]["content"], state["fundamentals_report"])
        self.assertIn("Bull", report["sections"]["debate"]["content"])
        self.assertIn("Bear", report["sections"]["debate"]["content"])
        self.assertEqual(report["sources"], [{"url": "https://example.com/filing", "section": "fundamentals"}])
        self.assertTrue(any("Missing report sections" in w for w in report["warnings"]))

    def test_no_sources_never_invents_evidence(self):
        report = build_report({}, "AAPL", "2026-10-13", {})
        self.assertEqual(report["sources"], [])
        self.assertEqual(report["sections"]["fundamentals"]["content"], "")
        self.assertTrue(any("did not include source" in w for w in report["warnings"]))

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.multiple(server, DATA=Path(self.temp.name), TOKEN="t" * 40)
        self.patch.start(); server.initialize()
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True); self.thread.start()
        self.base = f"http://127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown(); self.http.server_close(); self.patch.stop(); self.temp.cleanup()

    def request(self, method, path, owner="alice", body=None, token=True):
        headers = {"X-Research-User": owner, "Content-Type": "application/json"}
        if token: headers["Authorization"] = "Bearer " + "t" * 40
        req = Request(self.base + path, method=method, headers=headers, data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(req) as response: return response.status, json.load(response)
        except HTTPError as response: return response.code, json.load(response)

    @patch.object(server, "readiness", return_value={"ready": True})
    def test_ownership_concurrency_and_cancellation(self, _):
        status, body = self.request("POST", "/jobs", body={"symbol": "aapl"})
        self.assertEqual(status, 202); job_id = body["job"]["id"]
        self.assertEqual(self.request("POST", "/jobs", body={"symbol": "MSFT"})[0], 409)
        self.assertEqual(self.request("GET", "/jobs?id=" + job_id, owner="bob")[0], 404)
        self.assertEqual(self.request("DELETE", "/jobs?id=" + job_id, owner="bob")[0], 404)
        self.assertEqual(self.request("GET", "/jobs", owner="bob")[1]["jobs"], [])
        self.assertEqual(self.request("DELETE", "/jobs?id=" + job_id)[1]["job"]["status"], "cancelled")
        self.assertEqual(self.request("POST", "/jobs", body={"symbol": "MSFT"})[0], 202)

    def test_auth_and_missing_configuration(self):
        self.assertEqual(self.request("GET", "/health", token=False)[0], 401)
        with patch.object(server, "readiness", return_value={"ready": False}):
            self.assertEqual(self.request("POST", "/jobs", body={"symbol": "AAPL"})[0], 503)
        self.assertEqual(self.request("POST", "/jobs", body={"symbol": "../secrets"})[0], 400)

    @patch.object(server, "readiness", return_value={"ready": True})
    def test_persistence_save_and_restart(self, _):
        _, body = self.request("POST", "/jobs", body={"symbol": "AAPL"}); job_id = body["job"]["id"]
        with server.connection() as db:
            db.execute("UPDATE jobs SET status='completed',report=? WHERE id=?", (json.dumps({"sections": {"overview": {"content": "Original"}}}), job_id))
        self.assertEqual(self.request("PATCH", "/jobs?id=" + job_id, body={"saved": True})[1]["job"]["saved"], True)
        server.initialize()
        self.assertEqual(self.request("GET", "/jobs?id=" + job_id)[1]["job"]["report"]["sections"]["overview"]["content"], "Original")
        self.assertTrue(self.request("GET", "/jobs")[1]["jobs"][0]["saved"])
        _, pending = self.request("POST", "/jobs", body={"symbol": "MSFT"})
        with server.connection() as db: db.execute("UPDATE jobs SET status='running' WHERE id=?", (pending["job"]["id"],))
        server.initialize()
        self.assertEqual(self.request("GET", "/jobs?id=" + pending["job"]["id"])[1]["job"]["status"], "failed")

    def wait_status(self, job_id, expected):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            job = self.request("GET", "/jobs?id=" + job_id)[1]["job"]
            if job["status"] in expected: return job
            time.sleep(0.1)
        self.fail("Job did not reach " + str(expected))

    @patch.object(server, "readiness", return_value={"ready": True, "provider": "test", "deepModel": "test", "quickModel": "test"})
    def test_worker_success_and_process_cancellation(self, _):
        runner = Path(self.temp.name) / "test_runner.py"
        runner.write_text("import json,sys,time\nfrom pathlib import Path\np=Path(sys.argv[1])\nr=json.loads((p/'request.json').read_text())\nif r['symbol']=='SLOW': time.sleep(30)\n(p/'report.json').write_text(json.dumps({'sections':{'decision':{'content':'Test only'}}}))\n")
        stop = threading.Event(); thread = threading.Thread(target=server.worker, args=(stop, runner)); thread.start()
        try:
            _, body = self.request("POST", "/jobs", body={"symbol": "AAPL"})
            completed = self.wait_status(body["job"]["id"], ["completed"])
            self.assertEqual(completed["report"]["sections"]["decision"]["content"], "Test only")
            _, body = self.request("POST", "/jobs", body={"symbol": "SLOW"})
            job_id = body["job"]["id"]
            self.wait_status(job_id, ["running"])
            self.request("DELETE", "/jobs?id=" + job_id)
            self.wait_status(job_id, ["cancelled"])
        finally:
            stop.set(); thread.join(5)
        self.assertFalse(thread.is_alive())

    @patch.object(server, "readiness", return_value={"ready": True, "provider": "test", "deepModel": "test", "quickModel": "test"})
    def test_worker_timeout(self, _):
        runner = Path(self.temp.name) / "slow_runner.py"; runner.write_text("import time\ntime.sleep(30)\n")
        stop = threading.Event()
        with patch.dict(os.environ, {"RESEARCH_TIMEOUT_SECONDS": "1"}):
            thread = threading.Thread(target=server.worker, args=(stop, runner)); thread.start()
            try:
                _, body = self.request("POST", "/jobs", body={"symbol": "AAPL"})
                failed = self.wait_status(body["job"]["id"], ["failed"])
                self.assertIn("timed out", failed["error"])
            finally: stop.set(); thread.join(5)

class UpstreamTests(unittest.TestCase):
    def test_vendor_cache_writes_inside_the_job_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            script = "import yfinance as yf,sys; from pathlib import Path; p=Path(sys.argv[1])/'cache'/'yfinance'; p.mkdir(parents=True); yf.set_tz_cache_location(str(p)); c=yf.cache.get_tz_cache(); c.store('TEST','UTC'); assert c.lookup('TEST')=='UTC'; assert (p/'tkr-tz.db').exists()"
            subprocess.run([sys.executable, "-c", script, folder], check=True, timeout=20)

    def test_actual_repo_graph_builds_without_network(self):
        from tradingagents.default_config import DEFAULT_CONFIG
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"OPENAI_API_KEY": "test-key-never-sent"}):
            config = dict(DEFAULT_CONFIG, llm_provider="openai", deep_think_llm="gpt-5.5", quick_think_llm="gpt-5.4-mini",
                          data_cache_dir=folder, results_dir=folder, memory_log_path=folder + "/memory.md")
            graph = TradingAgentsGraph(config=config)
            names = graph.graph.get_graph().nodes
            self.assertIn("Fundamentals Analyst", names)
            self.assertIn("Market Analyst", names)

    def test_runner_invokes_upstream_contract(self):
        from runner import run
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            (path / "request.json").write_text(json.dumps({"symbol": "AAPL", "analysisDate": "2026-10-13", "provenance": {"commit": "test"}}))
            with patch("tradingagents.graph.trading_graph.TradingAgentsGraph") as graph:
                graph.return_value.propagate.return_value = ({"investment_plan": "Test conclusion", "final_trade_decision": "Test review"}, "HOLD")
                run(path)
                graph.return_value.propagate.assert_called_once_with("AAPL", "2026-10-13", asset_type="stock")
                report = json.loads((path / "report.json").read_text())
                self.assertEqual(report["sections"]["decision"]["content"], "Test review")

if __name__ == "__main__": unittest.main()
