import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {buildBroadSummary} from '../lib/research/broad-summary.mjs'
const root='reports/broad-strategy-2026-10-16/',r=JSON.parse(readFileSync(root+'results.json','utf8')),p=r.protocol,chosen=r.comparisons[r.selection.selected.id],summary=buildBroadSummary(r)
const arms={sp500:'S&P 500 subset',broad_liquid:'Broader liquid stocks',daily_opportunities:'Daily opportunities'},setups={morning_breakout:'Morning momentum',vwap_reclaim:'VWAP reclaim'},money=n=>n.toLocaleString('en-US',{style:'currency',currency:'USD'}),percent=n=>n.toFixed(2)+'%'
let report=`# Broader-universe day strategy

Status: research only, execution disabled. Generated ${r.generatedAt}.

The strategy, scanner, one-minute execution replay and owner-only Strategy Lab are implemented locally. This report does not authorize a new paper release or establish consistent profitability. The deployed paper strategy was not changed.

## Scope

The current Nasdaq directory and Alpaca asset catalog yielded ${r.catalogCount.toLocaleString('en-US')} classified common-stock candidates on NYSE and Nasdaq. Of those, ${r.eligibleCount.toLocaleString('en-US')} met the research price/liquidity/history rules on at least one date. The S&P 500 comparator includes ${r.sp500EligibleCount} of those stocks using the existing current constituent snapshot; it is a supported, classified subset, not a point-in-time complete S&P 500 history.

Period: ${p.period.start} to ${p.period.end}. Each research phase starts with ${money(p.risk.capital)}. A separate continuous replay keeps the same account running through the entire period. Do not add phase returns to calculate a two-year result.

Current listing membership and current broker availability introduce survivorship and selection bias. Historical screening and verified news catalysts are unavailable. This is a technical price/volume study before those filters. All historical shortlist screening/catalyst labels are explicitly unverified. These dates were inspected in earlier experiments, so later periods here are retrospective diagnostics, not a pristine project-wide holdout.

## Selection and selected-candidate results

Six setup/universe combinations were specified in broad-protocol.json before their returns were computed. Development data alone selects the candidate. The selection, semantic signal fingerprint, model and execution-data fingerprints are frozen in selection.json before validation/test comparisons are computed. Later results do not change that choice. Earlier failed experiments are preserved.

Development selection: ${setups[r.selection.selected.setup]} in ${arms[r.selection.selected.arm]}. Development qualified: ${r.selection.developmentQualified?'yes':'no; retained for diagnostics only'}.

| Period | Dates | Net P&L | Return | Closed trades | Profit factor | Daily-close drawdown | Higher-cost return | Baseline research gate |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
`
for(const [phase,{baseline:b,stress:s}]of Object.entries(chosen.phases))report+=`| ${phase} | ${b.split.start} to ${b.split.end} | ${money(b.pnl)} | ${percent(b.returnPct)} | ${b.trades} | ${b.profitFactor==null?'Unavailable':b.profitFactor.toFixed(2)} | ${percent(b.maximumDailyDrawdownPct)} | ${percent(s.returnPct)} | ${b.qualification.passed?'Passed this period':'Did not qualify'} |\n`
const full=r.continuous.baseline
report+=`
Continuous two-year replay of the development-selected combination: ${money(full.capital)} starting value, ${money(full.endingValue)} ending value, ${money(full.pnl)} net P&L, ${percent(full.returnPct)} return across ${full.trades} closed trades. Higher-cost return: ${percent(r.continuous.stress.returnPct)}. This is simulated technical performance with the material limitations described above.

## Predefined universe comparison

All six combinations use the same cash budget, sizing controls and costs. The daily-opportunity arm changes only the eligible opportunity set. Returns below are diagnostic comparisons and must not be used to retrospectively replace the frozen development choice.

| Setup | Universe | Development return / trades | Validation return / trades | Later test return / trades |
| :--- | :--- | :--- | :--- | :--- |
`
for(const c of Object.values(r.comparisons))report+=`| ${setups[c.parameters.setup]} | ${arms[c.parameters.arm]} | ${percent(c.phases.development.baseline.returnPct)} / ${c.phases.development.baseline.trades} | ${percent(c.phases.validation.baseline.returnPct)} / ${c.phases.validation.baseline.trades} | ${percent(c.phases.test.baseline.returnPct)} / ${c.phases.test.baseline.trades} |\n`
report+=`
## Scanner

Exchange-listed common-stock classification combines official directory ETF/test flags, name-based exclusions and active Alpaca US-equity availability. This is a conservative classification heuristic, not an audited security master. ETFs, preferred stock, warrants, units, notes, depositary receipts and unsupported exchange listings are excluded. Some legitimate common stocks may be absent because of naming or broker metadata.

Historical eligibility uses the previous session's price of at least $10, at least sixty previous daily observations, and the previous twenty sessions' average of close times volume of at least $50 million. Recent history must not be more than seven calendar days stale. Session opening price and the signal close must also be at least $10. Raw daily prices determine historical price eligibility. Split-affected sessions use raw fifteen-minute decision bars. Daily technical indicators are scaled into session nominal units using an opening-derived split factor, corroborated against price and volume precision. Raw one-minute execution prices preserve actual whole-share affordability. Sessions with an unverified scale are excluded and disclosed before any return is calculated. This is not a complete historical-symbol or corporate-action audit.

At 09:45 Eastern, the scanner ranks eligible stocks by first-fifteen-minute volume divided by the median corresponding opening volume of the previous twenty available observations, multiplied by one plus the absolute opening gap fraction. At least fifteen historical opening observations are required. The daily shortlist requires at least 1.5 times normal opening volume and an absolute opening gap from 0.5% to 5%, capped at twenty symbols with symbol as a deterministic tie-breaker. No current-day total volume, later high/low or future news is used for ranking.

Data acquisition may fetch a warmup window before a stock later becomes eligible. This determines which historical bars to retrieve, never whether to trade. Actual daily eligibility uses prior information only. Morning data contains only the first ninety regular-session minutes; complete pagination and checksums are retained. The eligible pool is recomputed per session rather than selected using future strategy returns.

## Entry and exit logic

Both setups require the previous stock close above its previous twenty-close average, and SPY's previous close above its previous fifty-close average. SPY must be above its cumulative session HLC-volume VWAP at the decision. SPY is a market reference only and is never traded. Opening activity must be at least normal, and the opening-range width must be 0.1 to 0.8 of the previous fourteen-session simple average true range.

Morning momentum requires a bullish opening candle, a nonnegative opening gap no larger than 5%, and a later completed fifteen-minute close crossing the opening high. The signal close must be above its candle open and VWAP, no more than 0.25 ATR above the opening high and no more than 0.75 ATR above VWAP. Return since the open must exceed SPY's. Target: two planned risk units.

VWAP reclaim requires a bearish opening candle whose low is at least 0.25 prior-session ATR below the previous close. A later completed candle must cross above VWAP, close above the previous candle high, exceed its own open and exceed the session open. Absolute opening gap must be at most 5%. Target: 1.5 planned risk units.

Decisions occur only after completed fifteen-minute candles, from 10:00 to 11:00 Eastern. The stop is the lower low of the signal and preceding candle, rounded down to cents. Stop distance must be 0.25% to 1.5% of the buy limit, which is 0.1% above the signal close. Each stock/setup has one opportunity per session, with no chasing. One-minute bars simulate entry fills, gaps, stops, profit targets, break-even stop adjustments, ninety-minute time exits and closeout five minutes before the actual calendar close. A stop can move to entry only after a completed minute closes one initial risk unit above the fill. No overnight positions are allowed.

## Cash, risk and costs

The initial risk budget is 0.25% of the lesser of starting capital and current equity, approximately $5 on $2,000. Position size is capped at half that capital/equity and available cash after pending-order reservations. Maximum two positions and two filled entries per day. Sale proceeds become available next session in this conservative research ledger. Actual broker cash availability still needs reconciliation before activation.

New entries pause for a modeled daily loss of 0.75% of starting capital and stop for the rest of a phase at 8% intraday account drawdown. Existing protected exposure continues its exits. These are controls, not guaranteed maximum losses: gaps can exceed them. No margin, shorting, derivatives, averaging down or martingale is permitted.

Baseline costs: five basis points adverse slippage plus 2.5 basis points spread on marketable buys and stop/time/close sells, and a hypothetical one-cent-per-share sell fee. Stress raises slippage to ten basis points. Buy prices are capped at their submitted limit. Profit-taking sells fill at target with no favorable gap improvement. These are assumptions, not a representation of Alpaca's actual fees or historical spreads.

Buy-limit touches are assumed fillable; queue position, partial fills and actual historical quotes are not reproduced. A stop takes precedence if a minute contains both stop and target. Entry-minute target profits are not credited; adverse entry-minute stops are applied. Missing held-position minute bars and missing closeouts fail the research qualification gate. Fifteen-minute HLC-volume VWAP is an approximation rather than exchange trade-level VWAP. Later bar revisions, historical halts, broker rejections and execution latency are not replayed.

## Promotion decision

${r.rejection.map(reason=>'- '+reason).join('\n')}

Positive retrospective returns alone cannot enable this strategy. The preflight requires a fresh quote with a spread no greater than 0.10%, verified fresh AAOIFI pass, a verified catalyst published no later than the decision and within ninety-six hours, confirmed cash, real-time feed verification, a historical-universe audit and prospective paper validation. Even a preflight pass returns executionEnabled=false; owner release and customer paper authorization are separate future integration steps. There is no broker submission path in this research code.

## Owner view and reproducibility

The local owner console now includes Strategy Lab, with strategy/period controls, risk details, the dated shortlist, comparison metrics and missing evidence. The read-only endpoint requires a configured owner identity; it exposes no brokerage credentials, trade submission or configuration mutation. Nothing in this task was published to Vercel or changed the active release.

Run from the tickrtalk directory in this order:

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

Raw market data stays in the ignored .local-run/broad-strategy directory. results.json contains all predefined comparisons, trades, curves and diagnostics. selection.json preserves development selection and semantic fingerprints. Fetch timestamps can change without invalidating an unchanged experiment; changes to signals, execution data, protocol or model cannot silently replace a frozen experiment.

Sources: [Nasdaq directory definitions](https://www.nasdaqtrader.com/trader.aspx?id=symboldirdefs), [Alpaca asset catalog](https://docs.alpaca.markets/us/docs/working-with-assets), [Alpaca historical-data documentation](https://alpaca.markets/learn/fetch-historical-data).
`
const newsPath='.local-run/broad-strategy/shortlist-news.json'
if(existsSync(newsPath)){const news=JSON.parse(readFileSync(newsPath,'utf8'));report+=`\n## Dated news evidence\n\nLatest-shortlist enrichment status: ${news.status}. Decision cutoff: ${news.asOf}. Evidence published or edited after the cutoff is excluded. Articles are evidence for review, not automatically verified catalysts. This covers only the latest dated shortlist and does not provide a full-period historical news filter.\n\n`;for(const [symbol,items]of Object.entries(news.evidence))report+=`- ${symbol}: ${items.length} eligible news item(s); catalyst verification pending.\n`;writeFileSync(root+'shortlist-news.json',JSON.stringify(news,null,2))}
if(existsSync(root+'fee-sensitivity.json')){const sensitivity=JSON.parse(readFileSync(root+'fee-sensitivity.json','utf8'));report+=`\n## Fee assumption sensitivity\n\nThe one-cent-per-share sell fee is a conservative hypothetical assumption, not Alpaca's actual commission schedule. Alpaca describes eligible self-directed US equity API trading as commission-free, with regulatory fees potentially applicable. [Alpaca commission disclosure](https://alpaca.markets/support/commission-clearing-fees), [regulatory fees](https://alpaca.markets/support/regulatory-fees).\n\nAfter inspecting the initial results, an explicitly post-hoc diagnostic reran only the frozen candidate with zero sell fees, retaining the original spread and slippage. No selection, model or baseline result was changed. This is an optimistic fee bound and not a historical reconstruction of regulatory fees.\n\n`;for(const [phase,m]of Object.entries(sensitivity.runs))report+=`- ${phase}: ${percent(m.returnPct)}, ${m.trades} trades.\n`;report+='\nThese additional figures do not remove the sample-size, data, screening or prospective-validation requirements.\n'}
writeFileSync(root+'report.md',report);writeFileSync('lib/strategies/research-summary.json',JSON.stringify(summary,null,2)+'\n')
const rows=['setup,universe,phase,date,symbol,qty,entry_minute,exit_minute,entry,exit,pnl,reason'],months=['setup,universe,phase,month,pnl,trades'],shortlists=['date,symbol,relative_volume,gap_pct,screening,catalyst']
for(const c of Object.values(r.comparisons))for(const [phase,{baseline:b}]of Object.entries(c.phases)){for(const t of b.tradeLog)rows.push([c.parameters.setup,c.parameters.arm,phase,t.date,t.symbol,t.qty,t.entryMinute,t.exitMinute,t.entry,t.exit,t.pnl,t.reason].join(','));for(const [month,m]of Object.entries(b.months))months.push([c.parameters.setup,c.parameters.arm,phase,month,m.pnl,m.trades].join(','))}
for(const [date,stocks]of Object.entries(r.shortlists))for(const s of stocks)shortlists.push([date,s.symbol,s.relativeVolume,s.gapPct,'unverified','unverified'].join(','))
writeFileSync(root+'trades.csv',rows.join('\n'));writeFileSync(root+'monthly-results.csv',months.join('\n'));writeFileSync(root+'daily-shortlists.csv',shortlists.join('\n'));writeFileSync(root+'owner-summary.json',JSON.stringify(summary,null,2))
console.log('Report and owner snapshot generated:',root+'report.md')
