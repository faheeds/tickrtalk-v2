# Five-minute Stocks in Play and earnings-momentum study

Generated 2026-10-16T23:13:25.176Z. Research only. Neither study changes or activates the published paper strategy.

## Sample and data

The current Alpaca-supported catalog contains 4,681 candidate symbols. Price history covers 2021-10-15 through 2026-10-15; chronological phases are development (2021-10-15 to 2024-10-14), validation (2024-10-15 to 2025-10-14), and test (2025-10-15 to 2026-10-15). The catalog is based on current listings and excludes delisted stocks, so historical survivor bias remains.

Opening-bar preparation recorded 574 eligible stock sessions without a usable opening bar, 17 unverified split scales and 21919 cases without a complete fourteen-session opening-volume history. Earnings histories returned for 2050 of 2057 historically eligible stocks; 7 were unavailable.

## Stocks in Play opening-range breakout

This follows the published five-minute rule set: first-bar relative volume at least 1.0, rank in the top 20 eligible names, price above $5, previous 14-session average volume at least 1 million shares, previous ATR above $0.50, and trade in the direction of the first five-minute candle. A long-only cash account buys a break of the first-bar high, risks 0.25% of the $2,000 account, uses a stop 0.10 ATR below entry and exits any remaining position at the close. No margin, shorting or options are used. These account constraints differ materially from the paper portfolio, which used up to 4x leverage and both directions.

Reference: [the published five-minute ORB study](https://concretumgroup.com/wp-content/uploads/2026/02/A-Profitable-Day-Trading-Strategy-For-The-U.S.-Equity-Market.pdf). Its reported portfolio includes short trades and leverage, so its return cannot be transferred to this cash-only version.

| Phase | Net P&L | Return | Trades | Win rate | Profit factor | Daily drawdown | Stress return | Ambiguous bar deferred |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| development | $-1275.34 | -63.77% | 2513 | 6.33% | 0.50 | 63.77% | -74.93% | -19.66% |
| validation | $-1115.19 | -55.76% | 1267 | 4.26% | 0.32 | 55.92% | -61.39% | -7.76% |
| test | $-1168.66 | -58.43% | 1306 | 4.82% | 0.34 | 58.80% | -67.49% | -35.86% |

Continuous five-year replay under the adverse entry-bar convention: $2000.00 to $149.86 (-1850.14 net, -92.51%). At higher slippage: -95.49%. If every ambiguous entry-bar stop is deferred to the next minute, the sensitivity return is -53.56%. This is an execution-order sensitivity, not a second valid fill estimate. 3134 of 4745 continuous trades had a one-minute bar touching both the entry and stop. The replay also recorded 5075 missing held-position minutes, 1 closeout fallback and 1 empty execution series. The phase resets are independent diagnostics and must not be added to calculate the continuous return.

## Earnings momentum

The rule requires positive EPS surprise of at least 5%, nonnegative revenue surprise, a positive reaction-session gain of at least 2%, and reaction-session volume of at least 1.5 times its 20-session average. After a provider-labelled pre-market report, the reaction session is that date; after a provider-labelled after-market report, it is the next session. The strategy enters only after the reaction session closes, uses a two-ATR protective stop, holds at most 20 sessions, and uses whole shares under cash-only sizing.

| Phase | Net P&L | Return | Trades | Win rate | Profit factor | Daily drawdown | Stress return |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| development | $-16.24 | -0.81% | 162 | 36.42% | 0.96 | 4.49% | -2.09% |
| validation | $53.82 | 2.69% | 49 | 42.86% | 1.54 | 2.00% | 2.52% |
| test | $3.08 | 0.15% | 51 | 43.14% | 1.03 | 2.47% | 0.02% |

Continuous replay: $2000.00 to $2029.43 (29.43 net, 1.47%). At higher slippage: 0.39%. 2300 event candidates passed the retrospective filters; 2289 had a provider-labelled before-open or after-close time and 11 did not.

## Limits and decision

FMP provides event dates and release-time labels for some rows, but these records do not include historical consensus revision snapshots. The estimate used for EPS surprise may not be the estimate available before release. This prevents a clean point-in-time earnings backtest. The current stock catalog is survivor biased, and historical AAOIFI status is unavailable. One-minute OHLC bars cannot model quote queues, partial fills or latency.

The event feed used is documented in the [FMP earnings report API](https://site.financialmodelingprep.com/developer/docs/stable/earnings-company).

Neither result establishes a winning strategy. Treat any positive return as a research lead only. Do not enable either strategy until point-in-time universe, earnings estimates, halal screening, broker costs and prospective paper fills are independently validated.
