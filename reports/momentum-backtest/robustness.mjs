// Robustness sweep and calendar-year comparison for the momentum rule, on the point-in-time universe only.
//
//   node reports/momentum-backtest/robustness.mjs [--capital 25000]
//
// Sweep (fixed before running): lookback 6-1, 9-1, 12-1 × top 10, 15, 20, 30 × rebalance on the first or the
// tenth session of the month, all without the market filter at 15 bps. If the published choice (12-1, top 20,
// first session) sits near the middle of its neighbours, the result is a property of the rule; if it is an
// outlier, it was a lucky parameter.
// Calendar years: the published variant against buy-and-hold SPY and SPUS, year by year, from the continuous run.
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {buyAndHold,toBars} from '../longterm-backtest/simulate.mjs'
import {loadMembership,simulateMomentum} from './momentum.mjs'

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]]:[]).filter(Boolean))
const root='.local-run/longterm/',out='reports/momentum-backtest/'
if(!existsSync(root+'config.json'))throw new Error('Run reports/longterm-backtest/fetch.mjs first; this reuses its data.')
const meta=JSON.parse(readFileSync(root+'config.json','utf8')),capital=Number(args.capital??25000)
const sessionsAll=meta.calendar.map(d=>d.date)
const phases={development:['2017-01-01','2021-12-31'],validation:['2022-01-01','2024-06-30'],test:['2024-07-01',meta.end],continuous:['2017-01-01',meta.end]}
const inIndex=loadMembership(out+'data/sp500_ticker_start_end.csv')
const data={};for(const symbol of meta.universe){const path=`${root}${symbol}-1Day.json`;if(!existsSync(path))continue;const bars=toBars(JSON.parse(readFileSync(path,'utf8')));if(bars.length>=300)data[symbol]=bars}
const bench={};for(const symbol of meta.benchmarks){const path=`${root}${symbol}-1Day.json`;if(existsSync(path))bench[symbol]=toBars(JSON.parse(readFileSync(path,'utf8')))}

const grid=[];for(const [label,lookback] of [['6-1',126],['9-1',189],['12-1',252]])for(const topN of [10,15,20,30])for(const [when,rebalanceSession] of [['first',0],['tenth',9]])grid.push({label,lookback,topN,when,rebalanceSession})
const sweep={}
for(const [name,[start,end]] of Object.entries(phases)){
  const sessions=sessionsAll.filter(d=>d>=start&&d<=end);if(!sessions.length)continue
  const rows=[]
  const universe={};for(const [when,rebalanceSession] of [['first',0],['tenth',9]])universe[when]=simulateMomentum({data,sessions,capital,topN:'all',eligible:inIndex,rebalanceSession,slippageBps:15})
  for(const g of grid){
    const r=simulateMomentum({data,sessions,capital,topN:g.topN,eligible:inIndex,lookback:g.lookback,skip:21,rebalanceSession:g.rebalanceSession,slippageBps:15})
    rows.push({...g,cagrPct:r.cagrPct,maxDrawdownPct:r.maxDrawdownPct,closedTrades:r.closedTrades,universeCagrPct:universe[g.when].cagrPct,universeMaxDrawdownPct:universe[g.when].maxDrawdownPct,excessVsUniverse:r.cagrPct-universe[g.when].cagrPct})
  }
  const spy=buyAndHold({bars:bench.SPY,sessions,capital}),spus=bench.SPUS?buyAndHold({bars:bench.SPUS,sessions,capital}):null
  sweep[name]={start,end,rows,spyCagrPct:spy.cagrPct,spyMaxDrawdownPct:spy.maxDrawdownPct,spusCagrPct:spus?.qty?spus.cagrPct:null,spusFrom:spus?.entryDate??null}
}

// Calendar years from the continuous run of the published variant.
const sessions=sessionsAll.filter(d=>d>=phases.continuous[0]&&d<=phases.continuous[1])
const published=simulateMomentum({data,sessions,capital,topN:20,eligible:inIndex,slippageBps:15})
const universeEw=simulateMomentum({data,sessions,capital,topN:'all',eligible:inIndex,slippageBps:15})
const spyCurve=buyAndHold({bars:bench.SPY,sessions,capital}).curve,spusCurve=bench.SPUS?buyAndHold({bars:bench.SPUS,sessions,capital}).curve:[]
function yearly(curve){
  const byYear={};let prev=null
  for(const c of curve){const y=c.date.slice(0,4);if(!byYear[y])byYear[y]={start:prev??c.equity};byYear[y].end=c.equity;prev=c.equity}
  return Object.fromEntries(Object.entries(byYear).map(([y,v])=>[y,Math.round((v.end/v.start-1)*10000)/100]))
}
const years={momentum:yearly(published.curve),universe:yearly(universeEw.curve),spy:yearly(spyCurve),spus:yearly(spusCurve.filter(c=>c.price>0))}
writeFileSync(out+'robustness.json',JSON.stringify({generatedAt:new Date().toISOString(),capital,sweep,years},null,2))

const pct=v=>v==null?'n/a':(v>0?'+':'')+v.toFixed(2)+'%',sign=v=>v==null?'n/a':(v>0?'+':'')+v.toFixed(1)
let md=`# Momentum robustness and calendar years\n\nGenerated ${new Date().toISOString()}. Point-in-time universe, no market filter, 15 bps slippage, $${capital.toLocaleString()} per phase. Same data and caveats as report.md (survivorship bias remains; research only).\n\n`
for(const [name,s] of Object.entries(sweep)){
  md+=`## ${name} (${s.start} to ${s.end}) — SPY ${pct(s.spyCagrPct)} CAGR, ${s.spyMaxDrawdownPct.toFixed(1)}% drawdown${s.spusCagrPct!=null?`; SPUS ${pct(s.spusCagrPct)}${s.spusFrom>s.start?' from '+s.spusFrom:''}`:''}\n\nCAGR by lookback and top N (rebalance on the first session; tenth session in parentheses). Universe equal weight: ${pct(s.rows[0].universeCagrPct)} (${pct(s.rows[1].universeCagrPct)}).\n\n| Lookback | top 10 | top 15 | top 20 | top 30 |\n| :--- | ---: | ---: | ---: | ---: |\n`
  for(const label of ['6-1','9-1','12-1']){
    md+=`| ${label} |`
    for(const topN of [10,15,20,30]){const a=s.rows.find(r=>r.label===label&&r.topN===topN&&r.when==='first'),b=s.rows.find(r=>r.label===label&&r.topN===topN&&r.when==='tenth');md+=` ${pct(a.cagrPct)} (${pct(b.cagrPct)}) |`}
    md+='\n'
  }
  md+=`\nMax drawdown, same grid:\n\n| Lookback | top 10 | top 15 | top 20 | top 30 |\n| :--- | ---: | ---: | ---: | ---: |\n`
  for(const label of ['6-1','9-1','12-1']){
    md+=`| ${label} |`
    for(const topN of [10,15,20,30]){const a=s.rows.find(r=>r.label===label&&r.topN===topN&&r.when==='first'),b=s.rows.find(r=>r.label===label&&r.topN===topN&&r.when==='tenth');md+=` ${a.maxDrawdownPct.toFixed(1)}% (${b.maxDrawdownPct.toFixed(1)}%) |`}
    md+='\n'
  }
  const ex=s.rows.map(r=>r.excessVsUniverse),beat=s.rows.filter(r=>r.excessVsUniverse>0).length
  md+=`\n${beat} of ${s.rows.length} settings beat their universe's equal-weight return; excess CAGR ranges ${sign(Math.min(...ex))} to ${sign(Math.max(...ex))} points.\n\n`
}
md+=`## Calendar years — published variant (12-1, top 20, first session) vs benchmarks\n\n| Year | Momentum | Universe equal weight | SPY | SPUS | Momentum minus SPY |\n| :--- | ---: | ---: | ---: | ---: | ---: |\n`
let wins=0,n=0
for(const y of Object.keys(years.spy)){const m=years.momentum[y],s=years.spy[y];if(m!=null&&s!=null){n++;if(m>s)wins++}md+=`| ${y} | ${pct(m)} | ${pct(years.universe[y])} | ${pct(s)} | ${years.spus[y]==null?'n/a':pct(years.spus[y])} | ${m!=null&&s!=null?sign(m-s):'n/a'} |\n`}
md+=`\nMomentum beat SPY in ${wins} of ${n} calendar years. The first year (2017) starts at the phase start, and the last ends at ${meta.end}, so both are partial.\n\n## How to read this\n\nA rule is robust if most cells in the grid beat the universe row and the published cell is not the best one by a wide margin. Year-by-year, an edge shows as beating the index in most years by modest amounts, not as two outlier years carrying the average. Momentum's known failure mode, a sharp reversal after a crash, would show as a deeply negative year; none of 2017 to 2026 contains a 2009-style reversal, so this sample cannot show it.\n`
writeFileSync(out+'robustness.md',md)
console.log(md)
