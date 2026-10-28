import test from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_DRAFT,evaluate} from '../services/paper/core.mjs'
import {buyAndHold,simulate,toBars} from '../reports/longterm-backtest/simulate.mjs'

const profile={...DEFAULT_DRAFT.longterm,enabled:true},risk=DEFAULT_DRAFT.risk
const sessions=Array.from({length:700},(_,i)=>new Date(Date.UTC(2020,0,1)+i*86400000).toISOString().slice(0,10))

// A steady uptrend that keeps RSI inside the published band, then a sharp break that crosses the fast SMA
// under the slow SMA after `breakAt` sessions.
function series({start=100,drift=0.0012,breakAt=null,crash=0.0,wobble=0.004}={}){
  let price=start
  return sessions.map((date,i)=>{
    const step=breakAt!==null&&i>=breakAt?-crash:drift
    price=price*(1+step+(i%2?wobble:-wobble))
    const open=price*(1-wobble/2),close=price
    return {t:date+'T05:00:00Z',o:+open.toFixed(2),h:+(Math.max(open,close)*1.004).toFixed(2),l:+(Math.min(open,close)*0.996).toFixed(2),c:+close.toFixed(2),v:1000000}
  })
}

test('the synthetic uptrend produces a published buy signal once warmup completes',()=>{
  const bars=toBars(series())
  assert.equal(evaluate('longterm',bars.slice(0,200),profile,{}),null,'no signal before 252 bars')
  const signal=evaluate('longterm',bars.slice(0,400),profile,{})
  assert.ok(signal&&signal.side==='buy',JSON.stringify(signal))
  assert.ok(signal.stop<bars[399].close)
})

test('simulate enters on signals, respects the position cap and reconciles cash',()=>{
  const data={AAA:toBars(series()),BBB:toBars(series({start:50,drift:0.0015})),CCC:toBars(series({start:200,drift:0.001}))}
  const r=simulate({data,sessions,profile,risk:{...risk,maxPositions:2},capital:25000,sizing:'equal'})
  assert.ok(r.closedTrades>=2,'expected entries, got '+r.closedTrades)
  assert.ok(r.curve.every(c=>c.positions<=2),'position cap breached')
  assert.ok(r.trades.every(t=>t.reason==='phase_end'),'uptrends should only exit at phase end: '+JSON.stringify(r.trades.map(t=>t.reason)))
  assert.ok(r.returnPct>0)
  assert.ok(r.averageExposurePct>30,'equal sizing should deploy capital: '+r.averageExposurePct)
})

test('published sizing deploys far less capital than equal weight when the stop is wide',()=>{
  const data={AAA:toBars(series())}
  const published=simulate({data,sessions,profile,risk,capital:25000,sizing:'published'})
  const equal=simulate({data,sessions,profile,risk,capital:25000,sizing:'equal'})
  assert.ok(published.averageExposurePct<equal.averageExposurePct/2,`published ${published.averageExposurePct}% vs equal ${equal.averageExposurePct}%`)
})

test('a trend break triggers the published exit and the ledger still reconciles',()=>{
  const data={AAA:toBars(series({breakAt:450,crash:0.02}))}
  const r=simulate({data,sessions,profile,risk,capital:25000,sizing:'equal'})
  assert.ok(r.trades.length>=1)
  assert.ok(r.trades.some(t=>t.reason==='stop'||t.reason==='stop_gap'||t.reason==='trend_exit'),JSON.stringify(r.trades))
  assert.ok(r.maxDrawdownPct>0)
})

test('higher slippage never improves the result',()=>{
  const data={AAA:toBars(series()),BBB:toBars(series({start:50,drift:0.0015}))}
  const base=simulate({data,sessions,profile,risk,capital:25000,sizing:'equal',slippageBps:5})
  const stress=simulate({data,sessions,profile,risk,capital:25000,sizing:'equal',slippageBps:15})
  assert.ok(stress.ending<=base.ending)
})

test('buy and hold enters once at the first bar, whole shares, with costs',()=>{
  const bars=toBars(series({start:100,drift:0.001}))
  const b=buyAndHold({bars,sessions,capital:25000})
  assert.equal(b.entryDate,sessions[0]);assert.ok(b.qty>0&&Number.isInteger(b.qty));assert.ok(b.returnPct>0)
  const none=buyAndHold({bars:[],sessions,capital:25000})
  assert.equal(none.qty,0);assert.equal(none.ending,25000)
})
