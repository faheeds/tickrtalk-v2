import test from 'node:test'
import assert from 'node:assert/strict'
import {toBars} from '../reports/longterm-backtest/simulate.mjs'
import {momentumScores,simulateMomentum} from '../reports/momentum-backtest/momentum.mjs'

const sessions=Array.from({length:600},(_,i)=>new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10))
function series(drift,start=100,breakAt=null){
  let p=start
  return toBars(sessions.map((d,i)=>{p*=1+(breakAt!==null&&i>=breakAt?-0.01:drift);const o=p*0.999;return {t:d+'T05:00:00Z',o:+o.toFixed(2),h:+(p*1.003).toFixed(2),l:+(o*0.997).toFixed(2),c:+p.toFixed(2),v:1e6}}))
}

test('12-1 score skips the latest month and needs a year of history',()=>{
  const bars=series(0.001)
  assert.equal(momentumScores(bars,251),null)
  const s=momentumScores(bars,300)
  assert.ok(s>0)
  assert.ok(Math.abs(s-(bars[279].close/bars[48].close-1))<1e-9)
})

test('the top N are the strongest trends, equal weighted, with no leverage',()=>{
  const data={}
  for(let k=0;k<8;k++)data['S'+k]=series(0.0002+k*0.0003)
  const r=simulateMomentum({data,sessions,topN:3,capital:25000})
  assert.ok(r.curve.every(c=>c.positions<=3),'position cap breached')
  assert.ok(r.curve.every(c=>c.cash>=-1e-6))
  const held=new Set(r.trades.map(t=>t.symbol))
  assert.ok(['S7','S6','S5'].every(s=>held.has(s)),'strongest names should be held: '+[...held])
  assert.ok(!held.has('S0'),'weakest name should never be held')
  assert.ok(r.returnPct>0&&r.averageExposurePct>40,JSON.stringify({ret:r.returnPct,exp:r.averageExposurePct}))
})

test('the market filter moves to cash when SPY is below its 200-day average',()=>{
  const data={A:series(0.001),B:series(0.0008,50)}
  const spy=series(0.0005,300,350)
  const plain=simulateMomentum({data,sessions,spy,topN:2,capital:25000,marketFilter:false})
  const filtered=simulateMomentum({data,sessions,spy,topN:2,capital:25000,marketFilter:true})
  assert.equal(plain.monthsInCash,0)
  assert.ok(filtered.monthsInCash>0,'filter never triggered')
  assert.ok(filtered.trades.some(t=>t.reason==='market_filter'))
  const tail=filtered.curve.slice(-30)
  assert.ok(tail.every(c=>c.positions===0),'should be in cash after the SPY break')
})

test('a drop-out is sold at the rebalance and replaced the next session',()=>{
  const data={A:series(0.002,100,400),B:series(0.001),C:series(0.0005)}
  const r=simulateMomentum({data,sessions,topN:2,capital:25000})
  const drop=r.trades.find(t=>t.symbol==='A'&&t.reason==='dropped_from_top')
  assert.ok(drop,'A should be dropped after its break: '+JSON.stringify(r.trades))
  const cEntry=r.trades.find(t=>t.symbol==='C')
  assert.ok(cEntry&&cEntry.entryDate>drop.exitDate,'C should enter after A leaves')
})

test('higher slippage never improves the result',()=>{
  const data={A:series(0.001),B:series(0.0008,50),C:series(0.0006,20)}
  const base=simulateMomentum({data,sessions,topN:2,capital:25000,slippageBps:5})
  const stress=simulateMomentum({data,sessions,topN:2,capital:25000,slippageBps:15})
  assert.ok(stress.ending<=base.ending)
})
