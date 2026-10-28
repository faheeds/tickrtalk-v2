import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
import {sessionPriceFactor} from '../services/strategy-research/nominal-prices.mjs'
import {simulateOpening} from '../services/strategy-research/evidence-model.mjs'
import {simulateEarnings} from '../services/strategy-research/evidence-simulation.mjs'

const protocolPath='services/strategy-research/evidence-protocol.json',root='.local-run/evidence-strategy/'
const protocolBytes=readFileSync(protocolPath),protocol=JSON.parse(protocolBytes),candidates=JSON.parse(readFileSync(root+'candidates.json','utf8'))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),protocolHash=hash(protocolBytes)
if(candidates.protocolHash!==protocolHash)throw new Error('Candidate signals use a different protocol. Rebuild candidates before running the study.')
for(const item of candidates.sourceHashes){const bytes=readFileSync(root+item.file);if(hash(bytes)!==item.sha256)throw new Error('Research input changed after candidate generation: '+item.file)}
const dailyManifest=JSON.parse(readFileSync(root+'daily-manifest.json','utf8'))
for(const item of dailyManifest.files){const bytes=readFileSync(root+item.file);if(hash(bytes)!==item.sha256)throw new Error('Daily market history failed its source checksum: '+item.file)}
const executionManifest=JSON.parse(readFileSync(root+'execution-manifest.json','utf8'))
if(executionManifest.candidatesProtocolHash!==protocolHash)throw new Error('Execution data belongs to another protocol.')
if(executionManifest.candidatesHash!==hash(readFileSync(root+'candidates.json')))throw new Error('Execution data was collected for another candidate list.')
for(const item of executionManifest.files){const bytes=readFileSync(root+item.file);if(hash(bytes)!==item.sha256)throw new Error('Execution history changed after collection: '+item.file)}
const sessions=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8')))
let executionDate='',executionData=null
const readSession=date=>{if(executionDate!==date){executionDate=date;executionData=JSON.parse(readFileSync(root+'executions/'+date+'.json','utf8'))}return executionData}
const splits=protocol.splits,orbRuns={}
for(const [phase,range]of Object.entries(splits)){
 const baseline=simulateOpening({sessions,shortlists:candidates.shortlists,readSession},protocol,range)
 const stress=simulateOpening({sessions,shortlists:candidates.shortlists,readSession},protocol,range,{slippageBps:protocol.costs.stressSlippageBps})
 const ambiguity=simulateOpening({sessions,shortlists:candidates.shortlists,readSession},protocol,range,{entryBarStopPolicy:'defer_until_next_minute'})
 orbRuns[phase]={baseline,stress,ambiguity};console.log('ORB',phase,'trades',baseline.trades,'P&L',baseline.pnl,'return',baseline.returnPct,'ambiguous-bar sensitivity',ambiguity.returnPct)
}
const orbContinuous=simulateOpening({sessions,shortlists:candidates.shortlists,readSession},protocol,{start:protocol.period.start,end:protocol.period.end})
const orbStress=simulateOpening({sessions,shortlists:candidates.shortlists,readSession},protocol,{start:protocol.period.start,end:protocol.period.end},{slippageBps:protocol.costs.stressSlippageBps})
const orbAmbiguity=simulateOpening({sessions,shortlists:candidates.shortlists,readSession},protocol,{start:protocol.period.start,end:protocol.period.end},{entryBarStopPolicy:'defer_until_next_minute'})
const symbolCache=new Map()
const symbolData=symbol=>{if(!symbolCache.has(symbol)){const raw=JSON.parse(readFileSync(root+'daily-raw/'+symbol+'.json','utf8')),adjusted=JSON.parse(readFileSync(root+'daily-split/'+symbol+'.json','utf8'));symbolCache.set(symbol,{raw:new Map(raw.map(b=>[b.t.slice(0,10),b])),adjusted:new Map(adjusted.map(b=>[b.t.slice(0,10),b]))})}return symbolCache.get(symbol)}
const readDaily=(symbol,date)=>symbolData(symbol).raw.get(date)??null
const readFactors=(symbol,date)=>{const data=symbolData(symbol);try{return sessionPriceFactor(data.adjusted.get(date),data.raw.get(date))}catch{return null}}
const earningsRuns={}
for(const [phase,range]of Object.entries(splits)){
 const earningsCandidates=candidates.earnings.filter(item=>item.date>=range.start&&item.date<=range.end)
 const baseline=simulateEarnings({sessions,candidates:earningsCandidates,readDaily,readFactors},protocol,range)
 const stress=simulateEarnings({sessions,candidates:earningsCandidates,readDaily,readFactors},protocol,range,{slippageBps:protocol.costs.stressSlippageBps})
 earningsRuns[phase]={baseline,stress};console.log('Earnings',phase,'candidates',earningsCandidates.length,'trades',baseline.trades,'P&L',baseline.pnl,'return',baseline.returnPct)
}
const earningsContinuous=simulateEarnings({sessions,candidates:candidates.earnings,readDaily,readFactors},protocol,{start:protocol.period.start,end:protocol.period.end})
const earningsContinuousStress=simulateEarnings({sessions,candidates:candidates.earnings,readDaily,readFactors},protocol,{start:protocol.period.start,end:protocol.period.end},{slippageBps:protocol.costs.stressSlippageBps})
const earningsTimeCoverage={known:candidates.earnings.filter(x=>x.timingVerified).length,unknown:candidates.earnings.filter(x=>!x.timingVerified).length}
const report={generatedAt:new Date().toISOString(),protocol,protocolHash,sourceHashes:candidates.sourceHashes,executionManifest,universe:{catalogSymbols:JSON.parse(readFileSync(root+'universe.json','utf8')).stocks.length,earnings:candidates.earningsAccess,openingExclusions:candidates.exclusions,earningsCandidateCount:candidates.earnings.length,earningsTimeCoverage,earningsEstimatePointInTimeVerified:false},orb:{phases:orbRuns,continuous:orbContinuous,continuousStress:orbStress,ambiguousBarSensitivity:orbAmbiguity,shortlists:candidates.shortlists},earnings:{phases:earningsRuns,continuous:earningsContinuous,continuousStress:earningsContinuousStress,candidates:candidates.earnings}}
const out='reports/evidence-strategy-2026-10-16/'
mkdirSync(out,{recursive:true});writeFileSync(out+'results.json',JSON.stringify(report))
const csv=(rows,fields)=>[fields.join(','),...rows.map(row=>fields.map(key=>JSON.stringify(row[key]??'')).join(','))].join('\n')+'\n'
const orbTrades=Object.entries(orbRuns).flatMap(([phase,data])=>data.baseline.tradeLog.map(t=>({phase,...t})))
const earningsTrades=Object.entries(earningsRuns).flatMap(([phase,data])=>data.baseline.tradeLog.map(t=>({phase,...t})))
writeFileSync(out+'orb-trades.csv',csv(orbTrades,['phase','date','symbol','rank','qty','entry','exit','stop','pnl','fees','reason','relativeVolume']))
writeFileSync(out+'earnings-trades.csv',csv(earningsTrades,['phase','date','symbol','eventDate','reactionDate','reportTime','qty','entry','exit','stop','pnl','fees','reason','surprisePct','reactionPct','relativeVolume']))
const rows=[]
for(const [phase,data]of Object.entries(orbRuns))rows.push({strategy:'Stocks in Play ORB',phase,...data.baseline,stressReturnPct:data.stress.returnPct,ambiguousDeferredReturnPct:data.ambiguity.returnPct})
for(const [phase,data]of Object.entries(earningsRuns))rows.push({strategy:'Earnings momentum',phase,...data.baseline,stressReturnPct:data.stress.returnPct})
writeFileSync(out+'phase-summary.csv',csv(rows,['strategy','phase','capital','endingValue','pnl','returnPct','trades','winRatePct','profitFactor','maximumDailyDrawdownPct','maximumPeakDrawdownPct','activeMonths','stressReturnPct','ambiguousDeferredReturnPct']))
writeFileSync(out+'orb-equity.csv',csv(orbContinuous.curve,['date','equity','cash','unsettled','fees']))
writeFileSync(out+'earnings-equity.csv',csv(earningsContinuous.curve,['date','equity','cash','unsettled']))
const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'n/a'
const phases=['development','validation','test']
const table=(runs,showAmbiguity=false)=>{const header='| Phase | Net P&L | Return | Trades | Win rate | Profit factor | Daily drawdown | Stress return |'+(showAmbiguity?' Ambiguous bar deferred |':'');const rule='| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'+(showAmbiguity?' ---: |':'');return [header,rule,...phases.map(phase=>{const data=runs[phase],baseline=data.baseline,stress=data.stress;return '| '+phase+' | $'+fmt(baseline.pnl)+' | '+fmt(baseline.returnPct)+'% | '+baseline.trades+' | '+fmt(baseline.winRatePct)+'% | '+fmt(baseline.profitFactor)+' | '+fmt(baseline.maximumDailyDrawdownPct)+'% | '+fmt(stress.returnPct)+'% |'+(showAmbiguity?' '+fmt(data.ambiguity.returnPct)+'% |':'')})].join('\n')}
const md=[
'# Five-minute Stocks in Play and earnings-momentum study',
'',
'Generated '+report.generatedAt+'. Research only. Neither study changes or activates the published paper strategy.',
'',
'## Sample and data',
'',
'The current Alpaca-supported catalog contains '+report.universe.catalogSymbols.toLocaleString()+' candidate symbols. Price history covers '+protocol.period.start+' through '+protocol.period.end+'; chronological phases are development ('+splits.development.start+' to '+splits.development.end+'), validation ('+splits.validation.start+' to '+splits.validation.end+'), and test ('+splits.test.start+' to '+splits.test.end+'). The catalog is based on current listings and excludes delisted stocks, so historical survivor bias remains.',
'',
'Opening-bar preparation recorded '+candidates.exclusions.missingOpening+' eligible stock sessions without a usable opening bar, '+candidates.exclusions.scale+' unverified split scales and '+candidates.exclusions.insufficientOpeningHistory+' cases without a complete fourteen-session opening-volume history. Earnings histories returned for '+(report.universe.earnings.cached??0)+' of '+(report.universe.earnings.requestedSymbols??0)+' historically eligible stocks; '+(report.universe.earnings.rejected??0)+' were unavailable.',
'',
'## Stocks in Play opening-range breakout',
'',
'This follows the published five-minute rule set: first-bar relative volume at least 1.0, rank in the top 20 eligible names, price above $5, previous 14-session average volume at least 1 million shares, previous ATR above $0.50, and trade in the direction of the first five-minute candle. A long-only cash account buys a break of the first-bar high, risks 0.25% of the $2,000 account, uses a stop 0.10 ATR below entry and exits any remaining position at the close. No margin, shorting or options are used. These account constraints differ materially from the paper portfolio, which used up to 4x leverage and both directions.',
'',
'Reference: [the published five-minute ORB study](https://concretumgroup.com/wp-content/uploads/2026/02/A-Profitable-Day-Trading-Strategy-For-The-U.S.-Equity-Market.pdf). Its reported portfolio includes short trades and leverage, so its return cannot be transferred to this cash-only version.',
'',
table(orbRuns,true),
'',
'Continuous five-year replay under the adverse entry-bar convention: $'+fmt(orbContinuous.capital)+' to $'+fmt(orbContinuous.endingValue)+' ('+fmt(orbContinuous.pnl)+' net, '+fmt(orbContinuous.returnPct)+'%). At higher slippage: '+fmt(orbStress.returnPct)+'%. If every ambiguous entry-bar stop is deferred to the next minute, the sensitivity return is '+fmt(orbAmbiguity.returnPct)+'%. This is an execution-order sensitivity, not a second valid fill estimate. '+orbContinuous.quality.ambiguousEntryStops+' of '+orbContinuous.trades+' continuous trades had a one-minute bar touching both the entry and stop. The replay also recorded '+orbContinuous.quality.missingHeldMinutes+' missing held-position minutes, '+orbContinuous.quality.missingClose+' closeout fallback and '+orbContinuous.quality.missingExecutionSeries+' empty execution series. The phase resets are independent diagnostics and must not be added to calculate the continuous return.',
'',
'## Earnings momentum',
'',
'The rule requires positive EPS surprise of at least '+protocol.earnings.minimumEpsSurprisePct+'%, nonnegative revenue surprise, a positive reaction-session gain of at least '+protocol.earnings.minimumReactionPct+'%, and reaction-session volume of at least '+protocol.earnings.minimumReactionRelativeVolume+' times its 20-session average. After a provider-labelled pre-market report, the reaction session is that date; after a provider-labelled after-market report, it is the next session. The strategy enters only after the reaction session closes, uses a two-ATR protective stop, holds at most '+protocol.earnings.maximumHoldingSessions+' sessions, and uses whole shares under cash-only sizing.',
'',
table(earningsRuns),
'',
'Continuous replay: $'+fmt(earningsContinuous.capital)+' to $'+fmt(earningsContinuous.endingValue)+' ('+fmt(earningsContinuous.pnl)+' net, '+fmt(earningsContinuous.returnPct)+'%). At higher slippage: '+fmt(earningsContinuousStress.returnPct)+'%. '+candidates.earnings.length+' event candidates passed the retrospective filters; '+earningsTimeCoverage.known+' had a provider-labelled before-open or after-close time and '+earningsTimeCoverage.unknown+' did not.',
'',
'## Limits and decision',
'',
'FMP provides event dates and release-time labels for some rows, but these records do not include historical consensus revision snapshots. The estimate used for EPS surprise may not be the estimate available before release. This prevents a clean point-in-time earnings backtest. The current stock catalog is survivor biased, and historical AAOIFI status is unavailable. One-minute OHLC bars cannot model quote queues, partial fills or latency.',
'',
'The event feed used is documented in the [FMP earnings report API](https://site.financialmodelingprep.com/developer/docs/stable/earnings-company).',
'',
'Neither result establishes a winning strategy. Treat any positive return as a research lead only. Do not enable either strategy until point-in-time universe, earnings estimates, halal screening, broker costs and prospective paper fills are independently validated.',
''
].join('\n')
writeFileSync(out+'report.md',md)
console.log('Study saved to',out)
