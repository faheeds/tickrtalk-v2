import {readFileSync,writeFileSync,copyFileSync} from 'node:fs'
const out='reports/backtest-2026-10-15/',r=JSON.parse(readFileSync(out+'results.json'))
const money=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD'}),pct=n=>n.toFixed(2)+'%'
const portfolios=r.portfolios.filter(x=>x.persistentHalt&&x.slippageBps===5&&x.capital!==1000)
let text=`# Day and Swing strategy backtest

Period: October 15, 2024 through October 15, 2026, inclusive. ${r.coverage[0].sessions} calendar sessions returned by Alpaca. Generated ${r.generatedAt}.

These are indicative historical simulations of the currently published price rules, not actual broker returns or a complete replay of the hosted application. Historical AAOIFI decisions and bid/ask quotes were unavailable. The published AAOIFI gate was bypassed for this analysis only. Live settings and trading authorizations were not changed.

## Shared capital across ten stocks

Each style is a separate simulation. The two styles do not share cash, positions or loss limits in this report. Do not add the returns to infer the simultaneous live account result.

| Style | Starting capital | Ending value | P&L | Return | Closed trades | Win rate | Maximum daily drawdown |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
`
for(const p of portfolios)text+=`| ${p.style==='day'?'Day':'Swing'} | ${money(p.capital)} | ${money(p.endingValue)} | ${money(p.pnl)} | ${pct(p.returnPct)} | ${p.trades} | ${pct(p.winRatePct??0)} | ${pct(p.maxDailyDrawdownPct)} |\n`
text+=`
## Each stock tested independently

Each Day column uses a fresh $2,000 allocation and each Swing column a fresh $3,500 allocation, matching the current owner allocations at the time of this analysis. These are separate single-stock runs, not contributions to the shared portfolio above. Whole-share sizing and unused cash are included. Zero trades means no filled eligible order under this model, not evidence of safety or profitability.

| Stock | Day P&L | Day return | Day trades | Swing P&L | Swing return | Swing trades |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
`
for(const s of r.symbols){const d=r.independent.find(x=>x.universe[0]===s&&x.style==='day'),w=r.independent.find(x=>x.universe[0]===s&&x.style==='swing');text+=`| ${s} | ${money(d.pnl)} | ${pct(d.returnPct)} | ${d.trades} | ${money(w.pnl)} | ${pct(w.returnPct)} | ${w.trades} |\n`}
text+=`
## Rules used

Published release: ${r.releaseId}, created ${r.releaseCreated}. This applies today's published parameters to the entire historical period. It does not replay earlier strategy versions.

Day: ${r.config.day.orbMinutes}-minute opening range; breakout close above range high and VWAP; previous close no more than 0.2% above range high; volume greater than ${r.config.day.volumeFactor} times opening-range average. All opening-range minutes must exist. Stop at the greater of range low or range midpoint, target entry signal close plus ${r.config.day.rewardMultiple} times range width. No new entries during the final ${r.config.risk.flattenMinutes+5} minutes; close day exposure ${r.config.risk.flattenMinutes} minutes before session end.

Swing: completed daily SuperTrend bearish-to-bullish crossover, period ${r.config.swing.trendPeriod}, multiplier ${r.config.swing.trendMultiplier}; ATR period ${r.config.swing.atrPeriod}; target signal close plus ${r.config.swing.rewardMultiple} ATR; stop 0.5% below SuperTrend with an 8% maximum signal stop distance. Uses a rolling 500-calendar-day daily history, with April 2024 warmup data for the initial period. Swing signals are evaluated once each session; the simulated entry uses the first observed opening-minute quote proxy and earliest fill in the following minute.

Shared controls: cash purchases of whole shares, no leverage or shorts, maximum ${r.config.risk.maxPositions} concurrent positions per style, maximum ${money(r.config.risk.maxOrder)} per order, fixed initial allocation risk of ${r.config.risk.riskPct}% per order and ${r.config.risk.dailyLossPct}% daily loss guard. Gross exposure cannot exceed the allocation. Profits are not used to increase the configured risk budget. Sale proceeds become available immediately in this model, matching the application's current allocation ledger; broker-specific settled-cash restrictions are not reproduced. A loss-guard breach pauses entries for the remainder of the test, reflecting the app's requirement to reauthorize. No baseline run reached that guard.

## Data and fills

Alpaca historical IEX minute and daily bars, adjustment=all, downloaded with full pagination. IEX is the feed used by the current app, and represents one exchange rather than the consolidated US market. Current constituent snapshot from ${r.universeAsOf??r.config.universeAsOf}; selection was ten recognizable names across several sectors, not optimized by returns. This introduces selection and survivorship bias. JPM is included for the price-rule test and must not be interpreted as a halal recommendation.

No future bar is used to generate an entry. Day signals use completed minute bars and earliest fills in the following minute. Swing uses only completed previous-day daily bars. Entry quotes are approximated by a 2.5 basis point ask premium. The production sizeEntry function sets the buy limit at 0.1% above that proxy ask. The baseline models 5 basis points adverse slippage on marketable buys and stop/session-close sells; buy fills are capped at their limit. Profit-taking limit orders fill at the target with no additional slippage. No commissions, regulatory fees, taxes, dividends credited to cash or borrowing are modeled. Fully adjusted historical prices incorporate retrospective corporate-action adjustments, so this is not a raw-price, cash-dividend total-return simulation.

Orders expire after ${r.config.risk.entryExpiryMinutes} minutes; intraday minute bars test stops and targets. Stop gaps use the bar open. If stop and target both occur in the same bar, stop is assumed first. Bar-level ordering, queue position and partial fills are unknown; target touches do not guarantee real fills. A missing final closeout bar uses the last observed session price. Maximum drawdown is measured at daily closes, not at every intraday extreme. At test end, remaining Swing positions are liquidated at the last observed minute close with slippage.

Quote staleness, actual spread checks, late historical bar revisions, dynamic broker tradability, broker reservations, rejected bracket orders, execution latency and historical screening are not replayed. The live cloud worker rotates styles and performs network scans; this model scans Day every minute and Swing near the open, so its sampling is not an exact reproduction of live decisions. Simultaneous signals are prioritized alphabetically, matching the engine's tie-breaker.

## Feed coverage

| Stock | Regular minute bars | Sessions missing complete opening range | Sessions with no regular minute bars | Eligible Swing signals before sizing |
| :--- | ---: | ---: | ---: | ---: |
`
for(const c of r.coverage)text+=`| ${c.symbol} | ${c.regularMinuteBars} | ${c.missingOpeningRangeSessions} / ${c.sessions} | ${c.noRegularBarsSessions} | ${c.swingSignals} |\n`
text+=`
Missing opening-range bars prevent Day entries, as the production rule requires consecutive minutes. This is a material data and strategy compatibility issue, particularly for JNJ and JPM. Missing data is not proof the stock had no market activity.

## Sensitivity

Doubling modeled adverse market/stop slippage from 5 to 10 basis points changes the shared Day return to ${pct(r.portfolios.find(x=>x.style==='day'&&x.slippageBps===10).returnPct)} and Swing to ${pct(r.portfolios.find(x=>x.style==='swing'&&x.slippageBps===10).returnPct)}. With only $1,000 per style, the Day return is ${pct(r.portfolios.find(x=>x.style==='day'&&x.capital===1000).returnPct)} and Swing executes ${r.portfolios.find(x=>x.style==='swing'&&x.capital===1000).trades} trade. Whole-share sizing makes smaller Swing budgets highly restrictive because a single share's stop risk often exceeds the allowed dollar risk.

The Swing sample of ${portfolios[1].trades} trades is too small to establish a reliable edge, despite its high observed win rate. The Day result does not support claiming the current price strategy is profitable. Results after the historical halal filter could differ materially in either direction.

## Verification and reproducibility

The optimized Day signal calculations were checked against the actual production evaluator for ${r.oracleChecks} positive cases and ${r.negativeOracleChecks} negative cases across all ten symbols. Swing calls the production evaluator directly, and both styles use production whole-share sizing. All runs assert cash reconciliation against the trade ledger and integer share quantities. These checks support calculation consistency, not execution realism.

Run from the tickrtalk project directory with the existing private hosted configuration: node reports/backtest-2026-10-15/fetch.mjs, followed by node reports/backtest-2026-10-15/run.mjs. Fetch performs only database and broker GET requests. Credentials stay in memory and are not written to this report or market-data files. Raw data is cached under .local-run/backtest. results.json contains parameters, equity series and trade ledgers. trades.csv contains the baseline shared-portfolio trades; daily-values.csv contains their daily equity.

Sources: [Alpaca historical bars](https://docs.alpaca.markets/us/reference/stockbars), [Alpaca market-data feed FAQ](https://docs.alpaca.markets/us/docs/market-data-faq). Strategy source: services/paper/core.mjs, services/paper/engine.mjs and lib/strategies/indicators.ts.
`
writeFileSync(out+'report.md',text)
const logs=portfolios.flatMap(p=>p.tradeLog),cols=['style','symbol','qty','entryTime','exitTime','entry','exit','pnl','reason']
writeFileSync(out+'trades.csv',cols.join(',')+'\n'+logs.map(t=>cols.map(c=>t[c]).join(',')).join('\n'))
writeFileSync(out+'daily-values.csv','style,date,equity,cash,positions\n'+portfolios.flatMap(p=>p.curve.map(d=>[p.style,d.date,d.equity,d.cash,d.positions].join(','))).join('\n'))
for(const name of ['fetch.mjs','run.mjs','report.mjs'])copyFileSync('.local-run/backtest/'+name,out+name)
console.log(JSON.stringify({report:out+'report.md',oracleChecks:r.oracleChecks,negativeOracleChecks:r.negativeOracleChecks,trades:logs.length}))
