// Runs the long-term backtest over fetched data and writes results, trades, daily values and a report.
//
//   node reports/longterm-backtest/run.mjs [--capital 25000] [--config path/to/release.json]
//
// Without --config the published defaults in services/paper/core.mjs (DEFAULT_DRAFT) are used. To test the
// exact published release instead, export its body to a JSON file with `risk` and `longterm` keys.
//
// Phases are fixed here, before any results exist, and must not be moved after looking at them:
//   development 2017-01-01 to 2021-12-31 · validation 2022-01-01 to 2024-06-30 · test 2024-07-01 to end.
// A continuous replay runs the whole period in one account. Do not add phase returns together.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {DEFAULT_DRAFT} from '../../services/paper/core.mjs'
import {buyAndHold,precomputeSignals,simulate,toBars} from './simulate.mjs'

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]]:[]).filter(Boolean))
const root='.local-run/longterm/',out='reports/longterm-backtest/'
if(!existsSync(root+'config.json'))throw new Error('Run fetch.mjs first.')
const meta=JSON.parse(readFileSync(root+'config.json','utf8'))
const draft=args.config?JSON.parse(readFileSync(args.config,'utf8')):DEFAULT_DRAFT
const profile={...draft.longterm,enabled:true},risk=draft.risk,capital=Number(args.capital??25000)
const sessionsAll=meta.calendar.map(d=>d.date)
const phases={development:['2017-01-01','2021-12-31'],validation:['2022-01-01','2024-06-30'],test:['2024-07-01',meta.end],continuous:['2017-01-01',meta.end]}

const data={},coverage=[]
for(const symbol of meta.universe){
  const path=`${root}${symbol}-1Day.json`;if(!existsSync(path)){coverage.push({symbol,bars:0,note:'missing file'});continue}
  const bars=toBars(JSON.parse(readFileSync(path,'utf8')))
  if(bars.length<300){coverage.push({symbol,bars:bars.length,note:'too little history; excluded'});continue}
  data[symbol]=bars;coverage.push({symbol,bars:bars.length,first:bars[0].date.toISOString().slice(0,10)})
}
const bench={};for(const symbol of meta.benchmarks){const path=`${root}${symbol}-1Day.json`;if(existsSync(path))bench[symbol]=toBars(JSON.parse(readFileSync(path,'utf8')))}

console.error('precomputing signals for',Object.keys(data).length,'symbols')
const signals=precomputeSignals(data,profile)
const results={generatedAt:new Date().toISOString(),feed:meta.feed,universeMode:meta.universeMode,universeAsOf:meta.universeAsOf,symbols:Object.keys(data).length,capital,profile,risk,phases:{},coverage}
const variants=[['published',5],['published',15],['equal',5],['equal',15]]
const allTrades=[],allCurves=[]
for(const [name,[start,end]] of Object.entries(phases)){
  const sessions=sessionsAll.filter(d=>d>=start&&d<=end);if(!sessions.length)continue
  const phase={start,end,sessions:sessions.length,variants:{},benchmarks:{}}
  for(const [sizing,slippageBps] of variants){
    const r=simulate({data,sessions,profile,risk,capital,sizing,slippageBps,signals})
    const key=`${sizing}_${slippageBps}bps`;phase.variants[key]={...r,trades:undefined,curve:undefined}
    if(slippageBps===5){allTrades.push(...r.trades.map(t=>({phase:name,sizing,...t})));allCurves.push(...r.curve.map(c=>({phase:name,sizing,...c})))}
  }
  for(const [symbol,bars] of Object.entries(bench)){
    const b=buyAndHold({bars,sessions,capital});phase.benchmarks[symbol]=b.qty?{...b,curve:undefined}:{unavailable:true,note:'no bars in this phase (fund not yet listed)'}
    if(b.qty)allCurves.push(...b.curve.map(c=>({phase:name,sizing:'benchmark:'+symbol,date:c.date,equity:c.equity})))
  }
  results.phases[name]=phase
}
mkdirSync(out,{recursive:true})
writeFileSync(out+'results.json',JSON.stringify(results,null,2))
const csv=(rows,cols)=>[cols.join(','),...rows.map(r=>cols.map(c=>r[c]??'').join(','))].join('\n')+'\n'
writeFileSync(out+'trades.csv',csv(allTrades,['phase','sizing','symbol','qty','entry','exit','entryDate','exitDate','days','reason','pnl','returnPct']))
writeFileSync(out+'daily-values.csv',csv(allCurves,['phase','sizing','date','equity','cash','positions']))

const pct=v=>v==null?'n/a':(v>0?'+':'')+v.toFixed(2)+'%',num=v=>v==null?'n/a':(v===Infinity?'∞':String(v))
let md=`# Long-term trend strategy backtest\n\nGenerated ${results.generatedAt}. Universe: ${meta.universeMode} (${results.symbols} symbols with enough history; snapshot ${meta.universeAsOf}). Feed: ${meta.feed}. Capital per phase: $${capital.toLocaleString()}. Rules: fast SMA ${profile.fastSma}, slow SMA ${profile.slowSma}, momentum ${profile.momentumDays} days, RSI ${profile.rsiMin} to ${profile.rsiMax}, stop at slow SMA × 0.98, max ${risk.maxPositions} positions, risk ${risk.riskPct}% per entry, max order $${risk.maxOrder}.\n\n`
md+=`This is an indicative simulation of the published price rules on Alpaca ${String(meta.feed).toUpperCase()} daily bars, adjustment=all. The universe is the current S&P 500 snapshot (survivorship bias) filtered by the static halal list in lib/halal.ts, which is approximate and unverified; the production AAOIFI gate was not applied. Entries fill at the next open plus costs; exits at the open or stop. Whole shares, no leverage. Do not add phase returns.\n\n`
md+=`"Published" sizing is the engine's risk-per-trade rule. "Equal" sizing (capital ÷ max positions) is a diagnostic to measure capital left idle by the published rule; it is not what the engine does.\n\n`
for(const [name,phase] of Object.entries(results.phases)){
  md+=`## ${name} (${phase.start} to ${phase.end}, ${phase.sessions} sessions)\n\n| Variant | Return | CAGR | Max drawdown | Trades | Win rate | Profit factor | Avg hold (days) | Avg exposure |\n| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`
  for(const [key,v] of Object.entries(phase.variants))md+=`| ${key} | ${pct(v.returnPct)} | ${pct(v.cagrPct)} | ${v.maxDrawdownPct.toFixed(2)}% | ${v.closedTrades} | ${v.winRatePct==null?'n/a':v.winRatePct.toFixed(1)+'%'} | ${num(v.profitFactor)} | ${num(v.averageHoldDays)} | ${v.averageExposurePct.toFixed(1)}% |\n`
  for(const [symbol,b] of Object.entries(phase.benchmarks))md+=b.unavailable?`| Buy and hold ${symbol} | not listed in this phase | | | | | | | |\n`:`| Buy and hold ${symbol} | ${pct(b.returnPct)} | ${pct(b.cagrPct)} | ${b.maxDrawdownPct.toFixed(2)}% | 1 | | | | 100% |\n`
  md+='\n'
}
md+=`## How to read this\n\nThe strategy earns its place only if the published variant beats buy-and-hold SPUS (or SPY where SPUS is not listed) on return and on drawdown, at 15 bps slippage, in validation and test, not only in development. A high return with low average exposure means the rule is mostly in cash; compare the equal-weight row to see what the sizing costs. Fewer than 100 closed trades across all phases is too few to trust.\n`
writeFileSync(out+'report.md',md)
console.log(md)
