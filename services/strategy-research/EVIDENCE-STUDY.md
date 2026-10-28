# Stocks in Play and earnings research

This is an owner research workflow. It cannot activate a strategy or place an order. It leaves the existing paper release unchanged.

The Stocks in Play experiment follows the published five-minute relative-volume rules and adapts execution to a $2,000 long-only cash account. It ranks the top twenty eligible stocks before applying the long-only rule, uses a 10% prior ATR stop and exits open positions at the session close. It does not use the paper study's short trades or leverage.

The earnings experiment requires a positive EPS surprise, nonnegative revenue surprise, a positive price reaction with elevated volume, an entry after that completed reaction session, a two ATR stop and a maximum holding period of twenty sessions. Provider-labelled before-open and after-close release times determine the reaction date. Missing or other time labels are never inferred. Consensus revision history is unavailable, so the earnings estimates are not point-in-time verified.

Run from the project directory after the five-year daily manifest is complete:

1. node scripts/fetch-evidence-openings.mjs
2. node scripts/fetch-evidence-earnings.mjs
3. node scripts/build-evidence-candidates.mjs
4. node scripts/fetch-evidence-executions.mjs
5. node scripts/run-evidence-study.mjs

The first collector downloads only opening bars for historically eligible stocks. The earnings collector requests histories only for stocks that met the price and dollar-volume screen at least once during the study window; each event is still tested against its own historical reaction-day conditions. The execution collector requests one-minute bars only for long candidates in the daily top-twenty list.

Provider data is cached under ignored .local-run/evidence-strategy/. Reports and trade ledgers are written to reports/evidence-strategy-2026-10-16/. Preserve source manifests and protocol hashes with each result. These historical experiments do not establish live profitability, halal status, fill quality or permission to trade.
