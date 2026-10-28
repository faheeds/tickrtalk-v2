"""Isolated browser QA fixture. Never used by the application research service."""
import json
import sys
import tempfile
import threading
from pathlib import Path

research_path = Path(__file__).resolve().parents[1] / "services" / "research"
sys.path.insert(0, str(research_path))
import server

if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as folder:
        server.DATA = Path(folder)
        server.readiness = lambda: {"ready": True, "missing": [], "engine": "TradingAgents", "provider": "UI TEST FIXTURE", "deepModel": "fixture", "quickModel": "fixture"}
        server.provenance = lambda: {"repository": "https://github.com/faheeds/TradingAgents_TauricResearch", "commit": "UI TEST FIXTURE", "workingTreeModified": False, "provider": "fixture", "deepModel": "fixture", "quickModel": "fixture"}
        server.initialize()
        runner = Path(folder) / "fixture_runner.py"
        runner.write_text("import sys,json,time\nfrom pathlib import Path\nsys.path.insert(0," + repr(str(research_path)) + ")\nfrom reports import build_report\np=Path(sys.argv[1])\nr=json.loads((p/'request.json').read_text())\n(p/'progress.json').write_text(json.dumps({'stage':'UI test fixture is preparing sections'}))\ntime.sleep(3)\nstate={k:'UI TEST FIXTURE. No live analysis performed.\\n\\n## Report detail\\n\\n| Field | Value |\\n| --- | --- |\\n| Coverage | Fixture |\\n\\n[Example source](https://example.com/report)\\n\\n<script>alert(1)</script>' for k in ['investment_plan','fundamentals_report','market_report','news_report','sentiment_report','trader_investment_plan','final_trade_decision']}\nstate['investment_debate_state']={'bull_history':'Fixture bull case','bear_history':'Fixture bear case','judge_decision':'Fixture research review'}\nstate['risk_debate_state']={'aggressive_history':'Fixture growth review','conservative_history':'Fixture caution','neutral_history':'Fixture balance','judge_decision':'Fixture risk review'}\nreport=build_report(state,r['symbol'],r['analysisDate'],r['provenance'])\nreport['warnings'].insert(0,'UI TEST FIXTURE. No live analysis performed.')\n(p/'report.json').write_text(json.dumps(report))\n", encoding="utf-8")
        http = server.ThreadingHTTPServer(("127.0.0.1", 8002), server.Handler)
        stop = threading.Event()
        worker = threading.Thread(target=server.worker, args=(stop, runner)); worker.start()
        print("Isolated UI test fixture listening on port 8002", flush=True)
        try: http.serve_forever()
        except KeyboardInterrupt: pass
        finally:
            stop.set(); worker.join(5); http.server_close()
