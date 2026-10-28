"""Lossless customer-facing report mapping from TradingAgents state."""
import re
from datetime import datetime, timezone

SECTIONS = {
    "overview": ("Research conclusion", "investment_plan"),
    "fundamentals": ("Fundamentals", "fundamentals_report"),
    "technical": ("Technical analysis", "market_report"),
    "news": ("News & macro", "news_report"),
    "sentiment": ("Market sentiment", "sentiment_report"),
    "tradePlan": ("Proposed trade plan", "trader_investment_plan"),
    "decision": ("Final risk review", "final_trade_decision"),
}

def coverage_warnings(log_text):
    warnings = []
    if "Reddit RSS fetch failed" in log_text:
        warnings.append("Some Reddit sentiment sources could not be retrieved. Social-source coverage is incomplete.")
    if "Optional macro_data unavailable" in log_text:
        warnings.append("Optional macro indicator data was unavailable for this run. Review macro claims against independent sources.")
    if re.search(r"Vendor '[^']+' failed for", log_text):
        warnings.append("At least one data-provider request failed during analysis. Review the analyst reports for coverage gaps and fallback evidence.")
    return warnings

def build_report(state, symbol, analysis_date, provenance):
    sections = {key: {"title": title, "content": str(state.get(field) or "")}
                for key, (title, field) in SECTIONS.items()}
    debate = state.get("investment_debate_state") or {}
    sections["debate"] = {"title": "Bull & bear debate", "content": "\n\n".join(
        f"## {title}\n\n{debate[key]}" for title, key in
        [("Bull case", "bull_history"), ("Bear case", "bear_history"), ("Research manager", "judge_decision")]
        if debate.get(key))}
    risk = state.get("risk_debate_state") or {}
    sections["risk"] = {"title": "Risk debate", "content": "\n\n".join(
        f"## {title}\n\n{risk[key]}" for title, key in
        [("Growth perspective", "aggressive_history"), ("Conservative perspective", "conservative_history"),
         ("Balanced perspective", "neutral_history"), ("Risk manager", "judge_decision")]
        if risk.get(key))}
    sources = []
    for key, section in sections.items():
        for url in re.findall(r"https?://[^\s<>\]\)\"']+", section["content"]):
            url = url.rstrip(".,;:")
            if not any(item["url"] == url and item["section"] == key for item in sources):
                sources.append({"url": url, "section": key})
    missing = [section["title"] for section in sections.values() if not section["content"].strip()]
    warnings = ["AI-generated research. A proposed trade plan is not an executed order.",
                "The analysis date is the requested cutoff, not proof that every data provider is point-in-time accurate.",
                "Source links are extracted from agent text and have not been independently verified."]
    if not sources:
        warnings.append("The agents did not include source URLs. Claims need independent verification.")
    if missing:
        warnings.append("Missing report sections: " + ", ".join(missing))
    return {"symbol": symbol, "analysisDate": analysis_date,
            "generatedAt": datetime.now(timezone.utc).isoformat(), "engine": "TradingAgents",
            "provenance": provenance, "sections": sections, "sources": sources, "warnings": warnings}
