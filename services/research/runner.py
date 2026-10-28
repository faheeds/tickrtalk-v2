"""One isolated TradingAgents invocation. No broker or execution imports."""
import json
import os
import sys
from functools import partial
from pathlib import Path

def run(job_dir):
    from langchain_core.callbacks import BaseCallbackHandler
    from tradingagents.default_config import DEFAULT_CONFIG
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from reports import build_report

    job_dir = Path(job_dir)
    import yfinance as yf
    vendor_cache = job_dir / "cache" / "yfinance"
    vendor_cache.mkdir(parents=True, exist_ok=True)
    yf.set_tz_cache_location(str(vendor_cache))
    request = json.loads((job_dir / "request.json").read_text(encoding="utf-8"))
    progress = job_dir / "progress.json"

    class Progress(BaseCallbackHandler):
        def on_chain_end(self, outputs, **kwargs):
            if not isinstance(outputs, dict):
                return
            stages = [("final_trade_decision", "Finishing risk review"),
                      ("risk_debate_state", "Reviewing risk perspectives"),
                      ("trader_investment_plan", "Preparing proposed trade plan"),
                      ("investment_plan", "Bringing the research together"),
                      ("investment_debate_state", "Comparing bull and bear cases"),
                      ("fundamentals_report", "Fundamentals report prepared"),
                      ("news_report", "News report prepared"),
                      ("sentiment_report", "Sentiment report prepared"),
                      ("market_report", "Technical report prepared")]
            for key, label in stages:
                if outputs.get(key):
                    temp = progress.with_suffix(".tmp")
                    temp.write_text(json.dumps({"stage": label}), encoding="utf-8")
                    temp.replace(progress)
                    break

    config = dict(DEFAULT_CONFIG)
    config.update({"results_dir": str(job_dir / "results"), "data_cache_dir": str(job_dir / "cache"),
                   "memory_log_path": str(job_dir / "memory.md"), "checkpoint_enabled": False})
    progress_handler = Progress()
    graph = TradingAgentsGraph(config=config, callbacks=[progress_handler])
    graph.propagator.get_graph_args = partial(graph.propagator.get_graph_args, callbacks=[progress_handler])
    state, _ = graph.propagate(request["symbol"], request["analysisDate"], asset_type="stock")
    report = build_report(state, request["symbol"], request["analysisDate"], request["provenance"])
    (job_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__":
    run(sys.argv[1])
