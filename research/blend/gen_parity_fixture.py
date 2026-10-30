"""Regenerates tests/fixtures/blend_parity.json from Yahoo daily bars.
Run: python research/blend/gen_parity_fixture.py <out.json>"""
import json, sys, warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd, yfinance as yf
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from blend_ref import indicators, plan, regime_on

SYMS = ["AAPL", "MSFT", "NVDA", "AMD", "QCOM", "AVGO", "TXN", "CSCO"]
MIN_BARS = 275   # same warm-up the TS runner requires
raw = yf.download(SYMS + ["SPY"], start="2024-01-02", end="2026-10-29", auto_adjust=False, progress=False, group_by="ticker", threads=False)
bars = {s: raw[s].dropna(how="all")[["Open", "High", "Low", "Close"]].round(4) for s in SYMS + ["SPY"]}
spy = bars.pop("SPY")
idx = list(spy.index)
cand_dates = [d for d in idx[MIN_BARS:]]
IND_ALL = {s_: indicators(df) for s_, df in bars.items()}
def n_daily_signals(d):
    n = 0
    for s_, t in IND_ALL.items():
        r = t.loc[d]
        n += int(bool(r["down3"]) and r["close"] > r["sma200"]) + int(r["ibs"] < 0.15) + int(r["cumrsi2"] < 35 and r["close"] > r["sma200"])
    return n
month_end_days = [d for i, d in enumerate(idx[:-1]) if d.month != idx[i + 1].month and i >= MIN_BARS]
busiest = sorted(cand_dates, key=lambda d: -n_daily_signals(d))[:6]
picked = sorted({*month_end_days[:3], *month_end_days[-1:], *busiest, idx[-1]})
ASOF = [str(d.date()) for d in picked]
MONTH_END = {str(d.date()): True for d in month_end_days}
# held scenarios for the planner (exercise exits + slot accounting)
HELD = {"mom": ["AAPL", "NVDA"], "down3": ["MSFT"], "ibs": ["AMD", "QCOM"], "crsi": ["TXN"]}
cases = []
for d in ASOF:
    ind = {s: indicators(df.loc[:d]).iloc[-1] for s, df in bars.items()}
    vals = {s: {k: (None if pd.isna(v) else float(v)) for k, v in r.items()} for s, r in ind.items()}
    me = MONTH_END.get(d, False)
    cases.append({
        "asof": d, "month_end": me, "regime": regime_on(spy, d), "indicators": vals,
        "plan_empty": plan(bars, spy, d, {}, me)["orders"],
        "plan_held": plan(bars, spy, d, HELD, me)["orders"],
    })
fx = {"held": HELD,
      "bars": {s: {"d": [str(i.date()) for i in df.index], "o": df.Open.tolist(), "h": df.High.tolist(), "l": df.Low.tolist(), "c": df.Close.tolist()}
               for s, df in {**bars, "SPY": spy}.items()},
      "cases": cases}
json.dump(fx, open(sys.argv[1], "w"), separators=(",", ":"))
print("cases", len(cases), "symbols", len(bars), "bars/sym", len(spy))
for c in cases: print(c["asof"], "regime", c["regime"], "empty-plan orders", len(c["plan_empty"]), "held-plan orders", len(c["plan_held"]))
