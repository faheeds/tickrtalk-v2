// Prints the 12-1 momentum ranking for a rebalance date, from the data fetched by reports/longterm-backtest/fetch.mjs.
//
//   node reports/momentum-backtest/rank.mjs [--date 2026-11-02] [--top 20] [--capital 25000]
//
// The score for a rebalance date uses closes through the previous session: close 21 sessions before the date
// divided by close 252 sessions before it, minus one. If the fetched data ends before the date, the missing
// sessions are assumed to be weekdays (fine for a couple of weeks with no market holidays); the closes the score
// needs are usually already on disk, since the most recent month is skipped by design. Refetch to be exact.
//
// Eligibility: in the S&P 500 on the date per data/sp500_ticker_start_end.csv, at least 252 sessions of history,
// and on the static halal list that built the universe. The static list is NOT the AAOIFI screen: verify every
// name in the top N against the screening service before trading. This prints research output, not advice.
import {existsSync,readFileSync} from 'node:fs'
import {toBars} from '../longterm-backtest/simulate.mjs'
import {loadMembership,momentumScores} from './momentum.mjs'

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]]:[]).filter(Boolean))
const root='.local-run/longterm/',out='reports/momentum-backtest/'
if(!existsSync(root+'config.json'))throw new Error('Run reports/longterm-backtest/fetch.mjs first.')
const meta=JSON.parse(readFileSync(root+'config.json','utf8'))
const date=args.date??new Date().toISOString().slice(0,10),top=Number(args.top??20),capital=Number(args.capital??25000)
const inIndex=loadMembership(out+'data/sp500_ticker_start_end.csv')

// Sessions after the data end are assumed to be weekdays.
function sessionsAfter(last,until){const out=[];const d=new Date(last+'T12:00:00Z');for(;;){d.setUTCDate(d.getUTCDate()+1);const iso=d.toISOString().slice(0,10);if(iso>until)break;if(d.getUTCDay()%6)out.push(iso)}return out}

const rows=[],skipped=[]
for(const symbol of meta.universe){
  const path=`${root}${symbol}-1Day.json`;if(!existsSync(path))continue
  const bars=toBars(JSON.parse(readFileSync(path,'utf8')))
  if(!inIndex(symbol,date)){skipped.push(symbol+': not in S&P 500 on '+date);continue}
  const lastDate=bars.at(-1).date.toISOString().slice(0,10)
  const extra=lastDate<date?sessionsAfter(lastDate,date).filter(d=>d<date).length:0
  // index of the rebalance session: first bar on/after the date, or past the end plus the assumed sessions
  let i=bars.findIndex(b=>b.date.toISOString().slice(0,10)>=date);if(i<0)i=bars.length+extra
  const score=momentumScores(bars,i)
  if(score===null){skipped.push(symbol+': under 252 sessions of history');continue}
  const recent=bars[i-21],old=bars[i-252]
  rows.push({symbol,score,recentDate:recent.date.toISOString().slice(0,10),recentClose:recent.close,oldDate:old.date.toISOString().slice(0,10),oldClose:old.close,lastDate,lastClose:bars.at(-1).close})
}
rows.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))
const slot=capital/top
console.log(`12-1 momentum ranking for rebalance on ${date} · ${rows.length} eligible names · data through ${rows[0]?.lastDate} · top ${top} · $${capital.toLocaleString()} (${'$'+slot.toFixed(0)} per name)\n`)
console.log('| # | Symbol | Score | Close ~12m ago | Close ~1m ago | Last close in data | Approx shares |')
console.log('| ---: | :--- | ---: | ---: | ---: | ---: | ---: |')
rows.slice(0,top).forEach((r,k)=>console.log(`| ${k+1} | ${r.symbol} | ${(r.score*100).toFixed(1)}% | ${r.oldClose.toFixed(2)} (${r.oldDate}) | ${r.recentClose.toFixed(2)} (${r.recentDate}) | ${r.lastClose.toFixed(2)} | ${Math.floor(slot/r.lastClose)} |`))
console.log(`\nNext in line (21 to ${top+5}): ${rows.slice(top,top+5).map(r=>`${r.symbol} ${(r.score*100).toFixed(1)}%`).join(', ')}`)
if(skipped.length)console.log(`\nSkipped ${skipped.length}: ${skipped.slice(0,8).join('; ')}${skipped.length>8?'; …':''}`)
console.log('\nVerify every name against the AAOIFI screening service before trading. Shares use the last close on disk; size on the live price at the open.')
