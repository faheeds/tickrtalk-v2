# TickrTalk paper execution

Local paper trading is configured for Day Trading with a $1,000 virtual budget. The published release is 47e1e04f-a999-4a8e-b951-8ee1b82214f8. The release universe is the full S&P 500 public constituent snapshot, containing 503 stock symbols, all verified as currently tradable by Alpaca. Existing manual holdings are excluded.

## Owner workflow

Open /preview/owner locally. Authenticated production owners use /dashboard/owner and must be explicitly listed in OWNER_USER_IDS. Edit the stock universe, profile parameters and execution limits. Save the draft, validate asset eligibility against Alpaca, review and publish a paper release. Validation does not constitute a backtest or prove profitability. Published releases are immutable. Changes apply to new entries; existing broker protection retains its original terms.

Customers choose Day, Swing or Medium / Long-Term and authorize a virtual budget in /preview/algo. Only the owner can edit strategy rules. Real execution has no activation path in this service.

The worker monitors every 15 seconds and evaluates eligible entries at most once per minute. Day entries begin after the configured opening range. Swing entries evaluate completed daily SuperTrend reversals. Medium / Long-Term uses daily price momentum, moving averages and RSI; it has no financial quality score. There is no validated return claim for any profile.

## Default limits

The current virtual budget cap is $1,000, the order cap is $500, and there are at most two managed positions. Planned stop-distance risk is 0.5% of authorized capital per trade. A 2% managed session loss pauses new entries. Stops, slippage, gaps and fill races can exceed planned risk; these settings are not guaranteed loss caps. Entries require fresh quotes and a spread of at most 0.5%. Unfilled entries expire after five minutes. Day closeout is scheduled five minutes before Alpaca's actual close, including early closes.

AAOIFI screening is currently off. These trades must not be described as halal certified. Required screening can be published only after the worker has a connected screening service and fully verified current passes. Missing, doubtful or stale checks reject new entries when screening is required.

## Automatic order lifecycle

Read broker account, clock, calendar, positions and open orders. Reconcile existing managed intents and fills. Evaluate completed bars and fresh quotes. Reserve a durable intent before submitting a protected limit entry to the fixed Alpaca paper endpoint. Reuse stable client IDs rather than retrying uncertain submissions. Unknown submissions reserve capital and pause new entries. Broker-confirmed cumulative fills create the execution ledger. REST reconciliation remains active if the trade-update stream fails.

Pausing cancels pending entries while protective monitoring continues. Owner halt applies to all paper accounts; clearing it requires fresh customer authorization. Close managed exposure cancels related protection, waits for broker cancellation and closes only tracked shares within broker-held quantity. Manual holdings are never adopted. Manual changes to managed symbols require reconciliation and can block new entries.

## Running locally

Use Node 25 or a supported Node version with node:sqlite. Install dependencies with npm install. Start the paper service with node --import tsx services/paper/server.mjs. It binds to 127.0.0.1:8003. The web app runs on 127.0.0.1:4173. The current production build directory is .next-paper. Set NEXT_BUILD_DIR to .next-paper when starting that build.

Private .env.paper contains the Alpaca paper key and secret, private service token and encryption key. The web bridge uses the matching token and PAPER_API_URL from .env.local. ENABLE_LOCAL_PAPER is an explicit loopback-only override; disable it on any hosted deployment. Never expose credentials in browser code. Preserve the paper encryption key and .paper-data SQLite database. Losing either prevents safe reconciliation. Back up both securely before moving hosts.

This computer must remain awake, connected and running both services. Automatic restart, deployment supervision and operational alerts are not installed. The application is not hosted for unattended use.

## Review findings addressed

The former execution path lacked durable idempotency, cumulative exposure accounting, reliable quote timestamps, safe quantity rounding, DST-aware scheduling, actual day closeout, stop-only protection and a trustworthy fill ledger. RSI and SuperTrend calculations were corrected. Unsafe legacy cron execution and account-wide reset routes are retired. Legacy broker account IDs now use the broker UUID. Legacy credential encryption requires a dedicated key and fails closed if missing; records encrypted under the former fallback may require reconnection.

## Still required before a commercial or live release

- Historical and out-of-sample strategy validation, realistic transaction costs and slippage, and a sustained market-hours paper trial. A connection test does not verify profitable trades or full entry-to-exit execution.
- Always-on worker hosting, recovery supervision, alert delivery, encrypted backups, incident procedures, and deliberate restart/network-failure drills.
- End-to-end hosted customer authentication, owner privileges, subscription entitlements, concurrency/load testing and isolation across multiple broker accounts.
- Full production reconciliation for corporate actions, account resets, fees, manual changes to managed symbols, short exposure and corrected broker fill records. Local FIFO P&L is a managed-trade view, not an account statement.
- Market-data coverage review. This implementation requests IEX data; opening-range volume and quotes are feed-specific. It does not claim consolidated market coverage.
- Verified AAOIFI service integration if screening is required.
- A separate live execution design, customer permission flow, broker eligibility checks and applicable legal/compliance review before real-money release.

## Verification on October 13 Pacific time

All 34 JavaScript tests passed, including duplicate reservations, uncertain submissions, partial fills, protected-leg preservation, loss guards, early-close monitoring while paused, customer isolation and paper endpoint enforcement. Type checks and production build passed. Alpaca reported an ACTIVE account, sufficient cash, no open orders and four unrelated existing holdings. One AAPL limit order at $0.01 was acknowledged and its cancellation confirmed; broker ID 4f92d0d6-e575-4d8b-911e-7ec978cb2026. No strategy fills existed during the closed-market setup. Day authorization is active for $1,000. Alpaca's next open was October 14 at 09:30 Eastern, or 06:30 Pacific. Entry evaluation waits until the opening range completes at 10:00 Eastern.

## S&P 500 universe expansion

The owner console offers S&P 500 or Custom stocks. S&P 500 uses the public datasets/s-and-p-500-companies CSV, sourced from Wikipedia. It is a sourced snapshot, not an official live index membership feed. The snapshot includes company names and sectors and is searchable in the owner console. Refreshing constituents does not silently alter a published release: save, validate and publish to adopt the refreshed list. New publication requires a snapshot retrieved within seven days. Trading rules and capital limits remain owner-controlled.

There are currently 503 constituent symbols, including distinct share classes. The custom universe limit is 600. Broker catalog eligibility is checked in one request; unavailable constituents are reported during validation and excluded at runtime. All 503 symbols in the current snapshot passed Alpaca eligibility checks. Held or ordered symbols are excluded from new entries, including manual holdings.

Full-universe history is fetched in groups of 50 with two requests active at most. Every group is fully paginated; repeated tokens, invalid schemas, rate limiting or a 25-second data deadline fail the scan closed. All available candidates are evaluated before selecting entries. Signals are ordered by momentum score where the profile provides one, then symbol. Capital and position reservations still constrain execution. The broker account, positions, orders and session are checked again after the scan; changed exposure blocks submission until a new cycle. Quote freshness uses the current time rather than the scan's original timestamp.

A read-only replay of October 13 data retrieved bars for all 503 symbols: 117,401 bars, fetched in 2.385 seconds and evaluated in 2.309 seconds. This checked data access and scan coverage only, placed zero orders, and is not a strategy-performance backtest. Tests verify full pagination, the final constituent's eligibility, safe publication of the complete list, and preservation of capital caps.

## Cash-funded stocks and allocation performance

The paper engine accepts US equity entries only, never options, futures or short sales. Broker configuration must have no_shorting enabled and max_margin_multiplier equal to 1. Account multiplier must be 1, cash must be nonnegative, and short exposure must be zero. Each entry checks positive broker cash, 1× stock buying_power and the allocation’s own confirmed-fill cash ledger. Open buy orders reserve cash. A confirmed sale restores allocation cash immediately, with no app cooldown or separate settlement wait. Entry funding is capped by both broker-available cash and the remaining allocation. Non-marginable buying power is not used as a stock-entry settlement timer. Settlement tracking remains informational. Missing or malformed financial data blocks entries. This policy controls order funding; it does not change Alpaca’s formal account classification.

Allocation history survives pausing and resuming the same budget. Changing budget or style requires managed positions to be closed, pending orders resolved and sale proceeds settled. The performance line starts at the authorized capital and includes only managed cash and stock positions. Daily observed values are persisted in SQLite. Flat historical days can be reconstructed from confirmed fills; missing historical marks for open positions remain gaps. Manual holdings and fees are excluded.

Day, Month, Quarter and Year groupings sum realized profit/loss and use the final value in each period. Exact figures and CSV export are available. Executions group partial fills by broker order; completed sales show FIFO purchase cost, realized profit/loss and return percentage. Unmatched purchase cost is shown as unavailable and blocks entries until reconciled.

On October 14, the original $1,000 allocation had two completed trades: VTRS lost $3.96 and BMY gained $10.57. Allocated value was $1,006.61, realized profit was $6.61, and managed exposure was flat. $798.86 in sale proceeds awaited settlement, while the unspent settled portion was $207.75. After the user clarified immediate re-entry, available allocation cash is $1,006.61 provided the broker has sufficient cash-based stock buying power. These are paper results before fees, not a profitability forecast.
