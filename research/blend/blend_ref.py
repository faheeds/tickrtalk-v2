"""
Reference implementation of the TickrTalk "Blend" strategy signals (research code).

Four equal-weight sleeves, long only, daily bars. This module mirrors exactly the
formulas used in the backtest that selected the strategy, and is the source of the
fixture that lib/strategies/blend-core.test.mjs checks the TypeScript port against.

  mom    monthly: rank 12-1 momentum / 60d volatility; hold top 10 (C>SMA200), exit when rank>20.  gate: SPY>SMA200
  down3  3 consecutive lower closes & C>SMA200; exit C>SMA5; 10 slots.                              gate: SPY>SMA200
  ibs    IBS=(C-L)/(H-L)<0.15; exit C>prior-day high; 10 slots.                                      gate: SPY>SMA200
  crsi   RSI(2)+RSI(2)[1] < 35 & C>SMA200; exit RSI(2)>65; 20 slots.                                gate: none
"""
import numpy as np, pandas as pd

SLEEVES = {"mom": 10, "down3": 10, "ibs": 10, "crsi": 20}
GATED = {"mom": True, "down3": True, "ibs": True, "crsi": False}
MOM_KEEP_RANK = 20


def rsi_wilder(c: pd.Series, n: int = 2) -> pd.Series:
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def indicators(df: pd.DataFrame) -> pd.DataFrame:
    """df: columns Open High Low Close. Returns indicator frame aligned to df.index."""
    C, H, L = df["Close"], df["High"], df["Low"]
    out = pd.DataFrame(index=df.index)
    out["close"] = C
    out["sma5"] = C.rolling(5).mean()
    out["sma200"] = C.rolling(200).mean()
    out["rsi2"] = rsi_wilder(C, 2)
    out["cumrsi2"] = out["rsi2"] + out["rsi2"].shift(1)
    out["ibs"] = (C - L) / (H - L).replace(0, np.nan)
    out["prev_high"] = H.shift(1)
    out["ret3"] = C / C.shift(3) - 1
    out["down3"] = (C < C.shift(1)) & (C.shift(1) < C.shift(2)) & (C.shift(2) < C.shift(3))
    out["mom"] = C.shift(21) / C.shift(252) - 1
    out["vol60"] = C.pct_change().rolling(60).std()
    out["momvol"] = out["mom"] / out["vol60"]
    return out


def regime_on(spy: pd.DataFrame, asof) -> bool:
    c = spy["Close"].loc[:asof]
    return bool(c.iloc[-1] > c.rolling(200).mean().iloc[-1])


def plan(bars: dict, spy: pd.DataFrame, asof, held: dict, month_end: bool):
    """
    Decide orders for the next open, using data through `asof` (inclusive).
    held: {sleeve: [symbols currently open]}.  Returns {"regime": bool, "orders": [(sleeve, side, symbol)]}.
    """
    ind = {s: indicators(df.loc[:asof]).iloc[-1] for s, df in bars.items()}
    gate = regime_on(spy, asof)
    # cross-sectional momentum rank (descending), NaNs excluded
    mv = pd.Series({s: r["momvol"] for s, r in ind.items()}).dropna()
    rank = mv.rank(ascending=False)
    orders = []
    for sleeve, N in SLEEVES.items():
        h = list(held.get(sleeve, []))
        exits = []
        for s in h:
            r = ind.get(s)
            if r is None:
                continue
            if sleeve == "mom":
                if month_end and s in rank.index and rank[s] > MOM_KEEP_RANK:
                    exits.append(s)
            elif sleeve == "down3" and r["close"] > r["sma5"]:
                exits.append(s)
            elif sleeve == "ibs" and r["close"] > r["prev_high"]:
                exits.append(s)
            elif sleeve == "crsi" and r["rsi2"] > 65:
                exits.append(s)
        slots = N - (len(h) - len(exits))
        cands = []
        if slots > 0 and (gate or not GATED[sleeve]):
            for s, r in ind.items():
                if s in h:
                    continue
                trend = r["close"] > r["sma200"]
                if sleeve == "mom":
                    ok = month_end and s in rank.index and rank[s] <= SLEEVES["mom"] and trend
                    score = r["momvol"]
                elif sleeve == "down3":
                    ok = bool(r["down3"]) and trend
                    score = -r["ret3"]
                elif sleeve == "ibs":
                    ok = r["ibs"] < 0.15
                    score = -r["ibs"]
                else:
                    ok = r["cumrsi2"] < 35 and trend
                    score = -r["cumrsi2"]
                if ok and not (isinstance(score, float) and np.isnan(score)):
                    cands.append((score, s))
            cands.sort(key=lambda x: (-x[0], x[1]))
        orders += [(sleeve, "sell", s) for s in exits]
        orders += [(sleeve, "buy", s) for _, s in cands[:max(slots, 0)]]
    return {"regime": gate, "orders": orders}
