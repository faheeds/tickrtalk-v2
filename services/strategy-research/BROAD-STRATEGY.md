# Broader stock opportunity strategy

This is a separate research experiment. It preserves the previous failed experiment and does not change the published paper strategy.

The scanner discovers NYSE and Nasdaq common-stock candidates from the Nasdaq directory and Alpaca's supported asset catalog. Historical eligibility requires at least $10 per share, sixty prior observations and $50 million in average daily dollar volume over the previous twenty sessions. A fifteen-minute opening-volume and gap scanner forms a daily list of up to twenty opportunities.

Two hypotheses are tested under identical cash and cost assumptions: morning breakout momentum and a VWAP reclaim following an opening selloff. Each is compared across the supported S&P 500 subset, the broader liquid universe, and the fixed daily opportunity shortlist. Decisions use completed fifteen-minute bars; potential trading sessions require one-minute execution history.

The initial research allocation is $2,000, risk per trade is approximately $5, and there are at most two filled entries per day. Whole-share sizing, cash reservations, conservative stop handling, cost stress and next-session availability of sale proceeds are modeled. These research cash assumptions do not change existing broker-aware cash handling in the app.

Run these from the project directory:

1. node scripts/fetch-broad-universe.mjs
2. node scripts/fetch-broad-raw-daily.mjs
3. node scripts/fetch-broad-intraday.mjs
4. node scripts/fetch-broad-nominal-mornings.mjs
5. node scripts/build-broad-signals.mjs
6. node scripts/fetch-broad-executions.mjs
7. node scripts/fetch-broad-news.mjs
8. node scripts/run-broad-strategy.mjs
9. node scripts/report-broad-strategy.mjs
10. npm test

The downloaders use the existing private hosted configuration and read-only market endpoints. Data is cached under the ignored .local-run/broad-strategy directory. They cannot place, cancel or alter broker orders. The news adapter excludes publications and edits after the decision cutoff and never promotes an article into a verified catalyst automatically.

The run freezes its development choice before examining later comparisons. Semantic fingerprints ignore fetch timestamps but detect changes to actual signals, execution files, model or protocol. Preserve a completed experiment and register a separate one rather than changing its rules after seeing results.

The owner console contains a read-only Strategy Lab. Its endpoint requires an authenticated configured owner. The panel shows research data, comparison periods, risk limits and missing evidence, with no activation button. The generated snapshot is a report artifact rather than a live scanning schedule. Refreshing the panel reloads the latest generated report; it does not run a backtest or create an order.

Historical AAOIFI status, time-stamped catalysts throughout the test period, point-in-time membership, real-time data entitlement and prospective paper reconciliation remain promotion requirements. Current listings bias historical research toward survivors. A profitable technical backtest is not a validated halal strategy or permission to execute. No strategy in this experiment is connected to the order engine.
