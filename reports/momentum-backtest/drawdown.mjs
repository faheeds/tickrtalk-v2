// Drawdown controls for the momentum rule, on the point-in-time universe at 15 bps, top 20, 12-1, no market filter.
//
//   node reports/momentum-backtest/drawdown.mjs [--capital 25000]
//
// Variants, fixed before running:
//   plain            the published rule (baseline)
//   riskadj          rank by 12-1 score ÷ trailing 126-session volatility
//   sector5          at most 5 names per GICS sector; lower-ranked names from other sectors fill the slots
//   sector4          at most 4 per sector
//   vol15 / vol20    scale exposure so the selected basket's trailing 63-session volatility targets 15% / 20% a year
//   riskadj+sector5  both filters
//   riskadj+vol20    both
// Each is judged on drawdown saved per point of CAGR given up, against plain, per phase and year by year.
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
const sectors=new Map(JSON.parse(readFileSync('services/paper/data/sp500.json','utf8')).members.map(m=>[m.symbol,m.sector])),sectorOf=s=>sectors.get(s)??null
const data={};for(const symbol of meta.universe){const path=`${root}${symbol}-1Day.json`;if(!existsSync(path))continue;const bars=toBars(JSON.parse(readFileSync(path,'utf8')));if(bars.length>=300)data[symbol]=bars}
const bench={};for(const symbol of meta.benchmarks){const path=`${root}${symbol}-1Day.json`;if(existsSync(path))bench[symbol]=toBars(JSON.parse(readFileSync(path,'utf8')))}

const base={topN:20,eligible:inIndex,slippageBps:15,capital}
const variants={
  plain:{},
  riskadj:{rankBy:'riskAdjusted'},
  sector5:{sectorOf,sectorMax:5},
  sector4:{sectorOf,sectorMax:4},
  vol15:{volTarget:0.15},
  vol20:{volTarget:0.20},
  'riskadj+sector5':{rankBy:'riskAdjusted',sectorOf,sectorMax:5},
  'riskadj+vol20':{rankBy:'riskAdjusted',volTarget:0.20},
}
const results={generatedAt:new Date().toISOString(),capital,phases:{},years:{}}
for(const [name,[start,end]] of Object.entries(phases)){
  const sessions=sessionsAll.filter(d=>d>=start&&d<=end);if(!sessions.length)continue
  const phase={start,end,firstSession:sessions[0],variants:{},benchmarks:{}}
  for(const [key,opts] of Object.entries(variants)){
    const r=simulateMomentum({data,sessions,...base,...opts})
    phase.variants[key]={cagrPct:r.cagrPct,returnPct:r.returnPct,maxDrawdownPct:r.maxDrawdownPct,closedTrades:r.closedTrades,averageExposurePct:r.averageExposurePct,annualTurnoverPct:r.annualTurnoverPct,averageExposureFraction:r.averageExposureFraction}
    if(name==='continuous')results.years[key]=yearly(r.curve)
  }
  for(const [symbol,bars] of Object.entries(bench)){const b=buyAndHold({bars,sessions,capital});phase.benchmarks[symbol]=b.qty?{cagrPct:b.cagrPct,maxDrawdownPct:b.maxDrawdownPct,entryDate:b.entryDate}:{unavailable:true};if(name==='continuous'&&b.qty)results.years[symbol]=yearly(b.curve.filter(c=>c.price>0))}
  results.phases[name]=phase
}
function yearly(curve){const byYear={};let prev=null;for(const c of curve){const y=c.date.slice(0,4);if(!byYear[y])byYear[y]={start:prev??c.equity};byYear[y].end=c.equity;prev=c.equity}return Object.fromEntries(Object.entries(byYear).map(([y,v])=>[y,Math.round((v.end/v.start-1)*10000)/100]))}
writeFileSync(out+'drawdown.json',JSON.stringify(results,null,2))

const pct=v=>v==null?'n/a':(v>0?'+':'')+v.toFixed(2)+'%',sign=v=>v==null?'n/a':(v>0?'+':'')+v.toFixed(1)
let md=`# Momentum drawdown controls\n\nGenerated ${results.generatedAt}. Point-in-time universe, top 20, 12-1, no market filter, 15 bps, $${capital.toLocaleString()} per phase. Same data and caveats as report.md (survivorship bias remains; research only). Every variant is compared with the plain rule: a control earns its place only if it saves more drawdown than the return it costs, in validation and test, not only in one phase.\n\n`
for(const [name,phase] of Object.entries(results.phases)){
  const plain=phase.variants.plain
  md+=`## ${name} (${phase.start} to ${phase.end})\n\n| Variant | CAGR | vs plain | Max drawdown | vs plain | Trades | Avg exposure | Turnover |\n| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`
  for(const [key,v] of Object.entries(phase.variants))md+=`| ${key} | ${pct(v.cagrPct)} | ${key==='plain'?'':sign(v.cagrPct-plain.cagrPct)} | ${v.maxDrawdownPct.toFixed(1)}% | ${key==='plain'?'':sign(v.maxDrawdownPct-plain.maxDrawdownPct)} | ${v.closedTrades} | ${v.averageExposurePct.toFixed(0)}% | ${v.annualTurnoverPct.toFixed(0)}% |\n`
  for(const [symbol,b] of Object.entries(phase.benchmarks))md+=b.unavailable?`| Buy and hold ${symbol} | not listed | | | | | | |\n`:`| Buy and hold ${symbol}${b.entryDate>phase.firstSession?' (from '+b.entryDate+')':''} | ${pct(b.cagrPct)} | ${sign(b.cagrPct-plain.cagrPct)} | ${b.maxDrawdownPct.toFixed(1)}% | ${sign(b.maxDrawdownPct-plain.maxDrawdownPct)} | | 100% | |\n`
  md+='\n'
}
const yearKeys=Object.keys(results.years.SPY??results.years.plain)
md+=`## Calendar years, continuous run\n\n| Year | ${Object.keys(variants).join(' | ')} | SPY | SPUS |\n| :--- | ${Object.keys(variants).map(()=>'---:').join(' | ')} | ---: | ---: |\n`
for(const y of yearKeys)md+=`| ${y} | ${Object.keys(variants).map(k=>pct(results.years[k]?.[y])).join(' | ')} | ${pct(results.years.SPY?.[y])} | ${results.years.SPUS?.[y]==null?'n/a':pct(results.years.SPUS[y])} |\n`
md+=`\n## How to read this\n\nThe "vs plain" columns are the trade: CAGR points given up against drawdown points saved. Volatility targeting holds cash when the basket is wild, so its exposure column shows how often it was de-risked; its worst case is a sharp rally while under-invested. The sector cap costs the most in years one theme carried the market and helps most when that theme breaks. Risk-adjusted ranking changes which names are held, so its effect can go either way; judge it over all phases. Nothing here removes market drawdown: SPY itself fell 34% in this sample, and a fully invested long-only book cannot do much better than the market in a crash without holding cash.\n`
writeFileSync(out+'drawdown.md',md)
console.log(md)
