# Selective morning momentum: research result

Decision: REJECTED_FOR_PROMOTION

No successful or consistently profitable strategy has been established. A working candidate and a reproducible research harness were built. All sixteen variants failed the development gate. The highest-scoring development variant was retained only for diagnostic testing; it is not approved for paper promotion or real-money trading.

Generated 2026-10-16T06:12:50.626Z. Protocol SHA-256: a55c9469e0f9e44bfe9d3c7a1a2e3b2b4ee3f1f34c84d9aefe5f089a97550cea. Model and data-loader SHA-256: e0956726eda7134a59250598ef56c935ab8b67bede3a698eec46b9c618c84c45. Selected candidate: breakout-15-v1.5-r2.

## What was tested

Thirty current S&P 500 stocks, October 15, 2024 through October 15, 2026, using consolidated SIP minute and daily bars. SPY is a market filter only and is never traded. Warmup data starts April 1, 2024. There are 7,672,038 regular-session minute bars across the warmup and research periods, including SPY. Split-adjusted prices and volume are used; cash dividends are not credited because all positions close intraday.

Stocks: AAPL, MSFT, NVDA, AMZN, GOOGL, META, JPM, XOM, JNJ, WMT, AMD, AVGO, ORCL, CRM, ADBE, COST, HD, PG, KO, PEP, ABBV, MRK, UNH, CVX, COP, CAT, GE, BA, GS, BAC.

This is a price-strategy study before AAOIFI screening. Historical halal decisions were unavailable. Some sample stocks would be excluded by the owner's current screening policy. This experiment cannot establish a halal portfolio's performance. Current membership, the hand-selected stock sample and previous project exposure to this period introduce selection and survivorship bias. The test below is chronologically separate from this experiment's selection process, but is not a pristine project-wide holdout or a prospective trial.

## Candidate rules

The selected variant uses a 15-minute opening range, opening volume at least 1.5 times the median corresponding opening volume of the previous twenty available sessions, and a two-risk-unit target. At least fifteen historical opening-volume observations are required.

Eligibility requires the stock's previous daily close above its previous twenty-close average and SPY's previous close above its fifty-close average. The stock opens flat to 3% above its previous close, and the opening-range close is above the opening price. The opening range must be between 0.1 and 0.8 of the previous fourteen-session average true range. These daily averages use only completed prior sessions.

Between the end of the opening range and 11:00 a.m. Eastern, a completed bullish minute closes through the range high. It must remain above VWAP, within 0.2 ATR above the range high and within 0.5 ATR above VWAP. SPY must be above its opening price and current VWAP, with its current close at least its close three minutes earlier. The stock's return since the open must exceed SPY's return since the open.

The stop is the lowest low of the last five completed minutes, rounded down to cents. The allowed stop distance is 0.25% to 1.5% of the entry limit. The entry limit is 0.1% above the signal close, rounded to cents. Entries can fill only from the next minute, expire after two minutes, and are canceled if the next observed opening price is already below the stop. Each stock has one opportunity per day; missed fills are not chased. The target is two times planned risk above the buy limit. After a completed bar closes at least one initial risk unit above the actual fill, the stop moves to the entry price for subsequent bars. That does not guarantee a break-even result after gaps, spread and fees.

No trade is required on any particular day. No averaging down, martingale, short sales, leverage, derivatives or overnight exposure is allowed.

## Cash and risk controls

The model starts each phase with $2,000.00. Risk per trade is 0.25% of the smaller of starting capital and current equity, approximately $5 initially. Whole-share quantities are capped at half that capital/equity and available cash after pending-order reservations. There are at most two simultaneous positions and two filled entries per day. Sale proceeds are held until the next market session in this conservative research model; the application currently has separate broker-aware cash handling and was not changed.

New entries stop for the day at a modeled 0.75% loss against the opening account value, and for the rest of a simulation phase at an 8% intraday account drawdown. These controls stop entries; existing protected positions continue their exits. Gaps can exceed configured loss thresholds. Each position closes after ninety minutes or five minutes before the calendar's market close. Early-close sessions use the broker calendar.

## Selection and results

Sixteen variants were fixed before obtaining their results: breakout versus retest; opening range of fifteen versus thirty minutes; relative volume threshold of one versus 1.5; target of 1.5 versus two risk units. Selection considers development results only. Eligible variants require at least sixty development trades, profit factor of 1.15, positive net profit, at least eight active months, at least 60% positive active months, and no more than 8% daily-close drawdown. There were no eligible variants. No candidate was selected using validation or final test returns.

The diagnostic winner was frozen in selection.json before computing the validation and final test. Rules were not retuned after seeing those results. Subsequent experiments using these dates must disclose that the periods have already been inspected.

| Phase | Dates | Starting capital | P&L | Return | Trades | Win rate | Profit factor | Daily-close drawdown | Cost stress return |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| development | 2024-10-15 to 2025-10-14 | $2,000.00 | -$6.52 | -0.33% | 49 | 36.73% | 0.93 | 1.90% | -1.64% |
| validation | 2025-10-15 to 2026-04-14 | $2,000.00 | -$4.41 | -0.22% | 10 | 50.00% | 0.80 | 0.72% | -0.52% |
| test | 2026-04-15 to 2026-10-15 | $2,000.00 | -$10.47 | -0.52% | 22 | 36.36% | 0.80 | 1.72% | -0.95% |

Each phase resets to $2,000 to measure that period independently. These returns are not additive and do not represent a single continuously funded account.

## Why it was rejected

- No development candidate satisfied the preregistered requirements.
- development: insufficient trades, nonpositive net profit, profit factor below threshold, insufficient monthly consistency
- development stressed costs: insufficient trades, nonpositive net profit, profit factor below threshold, insufficient monthly consistency
- validation: insufficient trades, nonpositive net profit, profit factor below threshold, insufficient monthly consistency
- validation stressed costs: insufficient trades, nonpositive net profit, profit factor below threshold, insufficient monthly consistency
- test: nonpositive net profit, profit factor below threshold, insufficient monthly consistency
- test stressed costs: nonpositive net profit, profit factor below threshold, insufficient monthly consistency
- Test block-bootstrap interval does not establish a positive mean return.

The final test's 90% moving-block bootstrap interval for mean daily account return is -0.02% to 0.00%. This is a descriptive uncertainty estimate using five-session blocks and 2,000 deterministic resamples. It is not a guarantee, does not account for every modeling error and is not a substitute for prospective observation. Positive mean return was not established.

## Costs and execution assumptions

Baseline marketable entry and stop/time/close fills use five basis points adverse slippage plus 2.5 basis points spread cost on each applicable side. Stress uses ten basis points slippage plus the same spread. Buys cannot exceed their submitted limit; a bar touching a buy limit is assumed eligible to fill in full. Profit targets fill at their limit with no favorable gap improvement. A conservative hypothetical sell fee of one cent per share is included. This fee is a modeling assumption, not a statement of Alpaca's actual fee schedule.

If a minute contains both a stop and a target, the stop takes precedence. New fills are checked for an adverse stop in the entry minute, but are not credited with a same-minute target. Quotes, queue priority, partial fills, auction mechanics, halts, dynamic broker restrictions and execution latency are not replayed. The model may overstate fills at touched limits. Stop prices are not guaranteed fill prices. Late revised historical bars are not the same as the stream observed in real time. Missing closeout data rejects a candidate; all selected-candidate phases had zero fallback closeouts.

This uses consolidated historical SIP data. The live app currently uses IEX, and historical SIP access does not verify real-time SIP entitlement. No subscription was purchased or upgraded. A future live implementation must establish feed compatibility and current entitlements before relying on these volume filters.

## Engineering verification

All 92 project tests passed, including ten new research tests covering signal timing, future-data isolation, invalid opening bars, trend and risk filters, whole-share cash sizing, adverse gap fills, stop-before-target ambiguity, fee and cash reconciliation, daylight saving, early closes, duplicate data and rejection of statistically empty candidates. Each simulated session also asserts cash is nonnegative and the trade ledger reconciles with account value. Market-data files have SHA-256 checksums verified before calculation. These checks support implementation consistency, not profitability.

The research model has no credentials or broker submission path. The downloader can issue only historical-bar and calendar GET requests, plus a read of the existing encrypted cloud checkpoint to obtain the owner's credentials privately. It does not change owner settings or submit/cancel orders. The model is not imported by the live execution engine. Existing paper authorizations and deployed strategy release were left unchanged. No production publication was attempted.

## Files and rerun

From the tickrtalk directory, run these sequentially:

1. node scripts/fetch-strategy-research.mjs
2. node scripts/run-strategy-research.mjs
3. node scripts/report-strategy-research.mjs
4. npm test

The downloader requires the existing private .env.hosted file, never prints its values, and caches historical bars under the ignored .local-run/strategy-research directory. results.json contains complete monthly results, curves, costs and trades. selection.json freezes the protocol, model and selection. Reruns refuse a changed model or selection rather than silently overwriting the experiment. To research a new hypothesis, create a separately registered experiment and preserve this failure.

## What remains before a strategy can be promoted

A different, economically motivated hypothesis must pass development and later-period cost stress checks without choosing it by test-period performance. Historical screening and a broader, appropriately sourced universe remain unverified. Any candidate that passes retrospective gates still needs a prospective shadow trial and paper execution reconciliation against actual quotes, fills, cash availability and screening. Real-time feed permissions must be verified. A paper trial must measure enough executions and market conditions to assess whether the backtest survives actual operation. This result provides no basis for enabling real-money execution or marketing consistent profits.

Sources: [Alpaca market-data feed documentation](https://docs.alpaca.markets/us/docs/market-data-faq), [Alpaca historical-data access](https://alpaca.markets/learn/fetch-historical-data), [FINRA on frequent intraday trading](https://syndication.finra.org/content/frequent-intraday-trading-understanding-basics).
