// Runs the 12-1 momentum backtest on the data fetched by reports/longterm-backtest/fetch.mjs (no new download).
//
//   node reports/momentum-backtest/run.mjs [--capital 25000]
//
// Phases match the long-term backtest and were fixed before any result existed:
//   development 2017-01-01 to 2021-12-31 · validation 2022-01-01 to 2024-06-30 · test 2024-07-01 to end · continuous.
// Variants (fixed in advance): top 10 and top 20, each with and without the SPY 200-day market filter, at 5 and 15 bps.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {buyAndHold,toBars} from '../longterm-backtest/simulate.mjs'
import {simulateMomentum} from './momentum.mjs'

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]]:[]).filter(Boolean))
const root='.local-run/longterm/',out='reports/momentum-backtest/'
if(!existsSync(root+'config.json'))throw new Error('Run reports/longterm-backtest/fetch.mjs first; this backtest reuses its data.')
const meta=JSON.parse(readFileSync(root+'config.json','utf8')),capital=Number(args.capital??25000)
const sessionsAll=meta.calendar.map(d=>d.date)
const phases={development:['2017-01-01','2021-12-31'],validation:['2022-01-01','2024-06-30'],test:['2024-07-01',meta.end],continuous:['2017-01-01',meta.end]}

const data={}
for(const symbol of meta.universe){const path=`${root}${symbol}-1Day.json`;if(!existsSync(path))continue;const bars=toBars(JSON.parse(readFileSync(path,'utf8')));if(bars.length>=300)data[symbol]=bars}
const bench={};for(const symbol of meta.benchmarks){const path=`${root}${symbol}-1Day.json`;if(existsSync(path))bench[symbol]=toBars(JSON.parse(readFileSync(path,'utf8')))}
const spy=bench.SPY;if(!spy)throw new Error('SPY bars are required for the market filter.')

const variants=[];for(const topN of [10,20])for(const marketFilter of [false,true])for(const slippageBps of [5,15])variants.push({topN,marketFilter,slippageBps})
const results={generatedAt:new Date().toISOString(),feed:meta.feed,universeMode:meta.universeMode,universeAsOf:meta.universeAsOf,symbols:Object.keys(data).length,capital,rule:'12-1 momentum, equal weight, monthly rebalance, sells at rebalance open, buys next open',phases:{}}
const allTrades=[],allCurves=[]
for(const [name,[start,end]] of Object.entries(phases)){
  const sessions=sessionsAll.filter(d=>d>=start&&d<=end);if(!sessions.length)continue
  const phase={start,end,firstSession:sessions[0],sessions:sessions.length,variants:{},benchmarks:{}}
  for(const v of variants){
    const r=simulateMomentum({data,sessions,spy,capital,...v}),key=`top${v.topN}_${v.marketFilter?'filtered':'plain'}_${v.slippageBps}bps`
    phase.variants[key]={...r,trades:undefined,curve:undefined,rebalanceLog:undefined}
    if(v.slippageBps===5){allTrades.push(...r.trades.map(t=>({phase:name,variant:key,...t})));allCurves.push(...r.curve.map(c=>({phase:name,variant:key,...c})))}
  }
  for(const [symbol,bars] of Object.entries(bench)){const b=buyAndHold({bars,sessions,capital});phase.benchmarks[symbol]=b.qty?{...b,curve:undefined}:{unavailable:true}}
  results.phases[name]=phase
}
mkdirSync(out,{recursive:true})
writeFileSync(out+'results.json',JSON.stringify(results,null,2))
const csv=(rows,cols)=>[cols.join(','),...rows.map(r=>cols.map(c=>r[c]??'').join(','))].join('\n')+'\n'
writeFileSync(out+'trades.csv',csv(allTrades,['phase','variant','symbol','qty','entry','exit','entryDate','exitDate','reason','pnl','returnPct']))
writeFileSync(out+'daily-values.csv',csv(allCurves,['phase','variant','date','equity','cash','positions']))

const pct=v=>v==null?'n/a':(v>0?'+':'')+v.toFixed(2)+'%',num=v=>v==null?'n/a':(v===Infinity?'∞':String(v))
let md=`# 12-1 cross-sectional momentum backtest\n\nGenerated ${results.generatedAt}. Universe: ${meta.universeMode} (${results.symbols} symbols; snapshot ${meta.universeAsOf}). Feed: ${meta.feed}. Capital per phase: $${capital.toLocaleString()}.\n\nRule: on the first session of each month, rank by the return from 252 to 21 sessions ago, hold the top N equal weight. Drop-outs sell at that open; entrants buy at the next open with settled cash; holdovers are untouched. "Filtered" variants hold cash when SPY's previous close is below its 200-session average. Whole shares, no leverage, no shorting. Costs: 2.5 bps spread plus the stated slippage per fill.\n\nIndicative simulation on a current-constituent universe (survivorship bias) filtered by the static halal list, not the production AAOIFI gate. This is research; the engine has no momentum style. Do not add phase returns.\n\n`
for(const [name,phase] of Object.entries(results.phases)){
  md+=`## ${name} (${phase.start} to ${phase.end}, ${phase.sessions} sessions)\n\n| Variant | Return | CAGR | Max drawdown | Trades | Win rate | Profit factor | Avg exposure | Annual turnover | Months in cash |\n| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`
  for(const [key,v] of Object.entries(phase.variants))md+=`| ${key} | ${pct(v.returnPct)} | ${pct(v.cagrPct)} | ${v.maxDrawdownPct.toFixed(2)}% | ${v.closedTrades} | ${v.winRatePct==null?'n/a':v.winRatePct.toFixed(1)+'%'} | ${num(v.profitFactor)} | ${v.averageExposurePct.toFixed(1)}% | ${v.annualTurnoverPct.toFixed(0)}% | ${v.monthsInCash}/${v.rebalances} |\n`
  for(const [symbol,b] of Object.entries(phase.benchmarks))md+=b.unavailable?`| Buy and hold ${symbol} | not listed in this phase | | | | | | | | |\n`:`| Buy and hold ${symbol}${b.entryDate>phase.firstSession?' (from '+b.entryDate+', not comparable)':''} | ${pct(b.returnPct)} | ${pct(b.cagrPct)} | ${b.maxDrawdownPct.toFixed(2)}% | 1 | | | 100% | | |\n`
  md+='\n'
}
md+=`## How to read this\n\nA variant earns a paper trial only if it beats buy-and-hold SPUS (SPY where SPUS is not listed) on return and drawdown at 15 bps in validation and test, not only development, with at least 100 closed trades overall. Turnover is one-way, as a share of starting capital per year; at 15 bps it costs roughly turnover × 0.0175% × 2 per year. Compare plain and filtered rows: the filter trades return for drawdown and must earn it in every phase, not just 2022.\n`
writeFileSync(out+'report.md',md)
console.log(md)
