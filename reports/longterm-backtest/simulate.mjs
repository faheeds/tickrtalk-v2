// Long-term style simulator. Pure functions over daily bars so tests can drive it with synthetic data.
//
// Rules are the published ones: `evaluate('longterm', …)` from services/paper/core.mjs decides entries and
// trend exits, and `sizeEntry` sizes the published variant. A second sizing mode, equal weight, exists only to
// measure how much capital the published risk-based sizing leaves idle. Nothing here changes the engine.
//
// Model, deliberately conservative:
//   - Signals use completed daily bars through the previous session. Entries fill at the next session's open
//     plus spread and slippage. Exits fill at the open (trend exit) or at the stop (gap below → open).
//   - Whole shares, no leverage, no shorting. Cash is debited at fill. Sale proceeds are available next session.
//   - The stop is fixed at entry (slow SMA × 0.98), like the engine's OTO stop order. The published rule's
//     target is zero, so there is no take-profit.
//   - Candidates are ranked by the rule's momentum score; at most `maxPositions` held; one entry per symbol per
//     signal bar. Symbols are only eligible once they have the warmup history the rule requires.
//   - Costs: spread 2.5 bps + slippage (5 bps baseline, 15 bps stress) on every fill.
import assert from 'node:assert/strict'
import {evaluate,round,sizeEntry} from '../../services/paper/core.mjs'

export function toBars(raw){
  return raw.map(b=>({date:new Date(b.t),open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v})).sort((a,b)=>a.date-b.date)
}
const day=d=>d.toISOString().slice(0,10)

/** Simulate one phase. `data` = {symbol: bars[]} (full history, warmup included). `sessions` = ISO dates. */
export function simulate({data,sessions,profile,risk,capital=25000,sizing='published',slippageBps=5,spreadBps=2.5,maxEntriesPerDay=Infinity}){
  const slip=slippageBps/10000,spread=spreadBps/10000
  const index=Object.fromEntries(Object.entries(data).map(([s,bars])=>[s,new Map(bars.map((b,i)=>[day(b.date),i]))]))
  const positions=new Map(),trades=[],curve=[];let cash=capital,settling=0,peak=capital,maxDrawdown=0,exposureSum=0
  const value=last=>cash+settling+[...positions.values()].reduce((s,p)=>s+p.qty*(last.get(p.symbol)??p.entry),0)
  const sell=(p,price,date,reason)=>{
    const fill=round(price*(1-spread-slip)),pnl=p.qty*(fill-p.entry)
    settling+=p.qty*fill;positions.delete(p.symbol)
    trades.push({symbol:p.symbol,qty:p.qty,entry:p.entry,exit:fill,entryDate:p.entryDate,exitDate:date,days:p.days,reason,pnl:round(pnl),returnPct:round((fill/p.entry-1)*100)})
  }
  for(const date of sessions){
    cash+=settling;settling=0
    const last=new Map(),today={},history={}
    for(const symbol of Object.keys(data)){
      const i=index[symbol].get(date);if(i===undefined)continue
      today[symbol]=data[symbol][i];history[symbol]=data[symbol].slice(Math.max(0,i-600),i)
      last.set(symbol,data[symbol][i].open)
    }
    // Exits first, using completed bars through the previous session.
    for(const p of [...positions.values()]){
      const bar=today[p.symbol];if(!bar)continue
      p.days++
      const decision=evaluate('longterm',history[p.symbol],profile,{})
      if(decision?.side==='sell')sell(p,bar.open,date,'trend_exit')
      else if(bar.open<=p.stop)sell(p,bar.open,date,'stop_gap')
      else if(bar.low<=p.stop)sell(p,p.stop,date,'stop')
    }
    // Entries: rank qualifying signals by score, fill open slots.
    const signals=[]
    for(const symbol of Object.keys(today)){
      if(positions.has(symbol))continue
      const signal=evaluate('longterm',history[symbol],profile,{})
      if(signal?.side==='buy')signals.push({symbol,signal})
    }
    signals.sort((a,b)=>(b.signal.score??0)-(a.signal.score??0)||a.symbol.localeCompare(b.symbol))
    let entries=0
    for(const {symbol,signal} of signals){
      if(positions.size>=risk.maxPositions||entries>=maxEntriesPerDay)break
      const open=today[symbol].open,gross=[...positions.values()].reduce((s,p)=>s+p.qty*(last.get(p.symbol)??p.entry),0)
      let sized
      if(sizing==='published'){
        sized=sizeEntry({budget:capital,remaining:Math.max(0,capital-gross),cash:Math.max(0,cash),signal,quote:{ap:open*(1+spread)},risk})
      }else{
        const slot=Math.min(capital/risk.maxPositions,cash,Math.max(0,capital-gross)),price=round(open*(1+spread)*1.001)
        const qty=Math.floor(slot/price);sized=qty>=1&&signal.stop<price?{qty,price,stop:signal.stop}:null
      }
      if(!sized)continue
      const fill=round(Math.min(sized.price,open*(1+spread+slip))),cost=sized.qty*fill
      if(cost>cash+1e-8)continue
      cash-=cost;entries++
      positions.set(symbol,{symbol,qty:sized.qty,entry:fill,stop:sized.stop,entryDate:date,days:0})
    }
    for(const [symbol,bar] of Object.entries(today))last.set(symbol,bar.close)
    const equity=value(last),invested=equity-cash-settling
    peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);exposureSum+=invested/equity
    curve.push({date,equity:round(equity),cash:round(cash+settling),positions:positions.size})
  }
  // Liquidate at the final close so phases are comparable.
  const lastDate=sessions.at(-1)
  for(const p of [...positions.values()]){const bars=data[p.symbol],i=index[p.symbol].get(lastDate)??bars.length-1;sell(p,bars[i].close,lastDate,'phase_end')}
  cash+=settling;settling=0
  if(curve.length)curve.at(-1).equity=round(cash)
  maxDrawdown=Math.max(maxDrawdown,(peak-cash)/peak*100)
  assert.ok(cash>=-1e-6,'cash went negative')
  assert.ok(trades.every(t=>Number.isInteger(t.qty)&&t.qty>=1),'fractional or empty trade')
  assert.ok(Math.abs(capital+trades.reduce((s,t)=>s+t.pnl,0)-cash)<0.05*Math.max(1,trades.length),'ledger does not reconcile')
  return {...metrics(trades,capital,cash,sessions),maxDrawdownPct:round(maxDrawdown),averageExposurePct:round(exposureSum/Math.max(1,sessions.length)*100),trades,curve}
}

/** Buy and hold one symbol from the first session with a bar, whole shares, same entry costs. */
export function buyAndHold({bars,sessions,capital=25000,slippageBps=5,spreadBps=2.5}){
  const slip=slippageBps/10000,spread=spreadBps/10000,byDate=new Map(bars.map(b=>[day(b.date),b]))
  let qty=0,cash=capital,entry=null,entryDate=null;const curve=[];let peak=capital,maxDrawdown=0
  for(const date of sessions){
    const bar=byDate.get(date);if(!bar){curve.push({date,equity:round(cash+qty*(curve.at(-1)?.price??0)),price:curve.at(-1)?.price??0});continue}
    if(!qty){entry=round(bar.open*(1+spread+slip));qty=Math.floor(capital/entry);cash=capital-qty*entry;entryDate=date}
    const equity=cash+qty*bar.close;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100)
    curve.push({date,equity:round(equity),price:bar.close})
  }
  const lastBar=[...sessions].reverse().map(d=>byDate.get(d)).find(Boolean)
  const exit=lastBar?round(lastBar.close*(1-spread-slip)):0,ending=qty?cash+qty*exit:capital
  return {entryDate,qty,entry,ending:round(ending),returnPct:round((ending/capital-1)*100),cagrPct:cagr(capital,ending,sessions),maxDrawdownPct:round(maxDrawdown),curve}
}

function cagr(start,end,sessions){const years=sessions.length/252;return years>0&&end>0?round((Math.pow(end/start,1/years)-1)*100):null}
function metrics(trades,capital,cash,sessions){
  const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0)
  const grossWin=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=-losses.reduce((s,t)=>s+t.pnl,0)
  return {capital,ending:round(cash),pnl:round(cash-capital),returnPct:round((cash/capital-1)*100),cagrPct:cagr(capital,cash,sessions),closedTrades:trades.length,
    winRatePct:trades.length?round(wins.length/trades.length*100):null,profitFactor:grossLoss>0?round(grossWin/grossLoss):(grossWin>0?Infinity:null),
    averageHoldDays:trades.length?round(trades.reduce((s,t)=>s+t.days,0)/trades.length):null,expectancyPerTrade:trades.length?round((cash-capital)/trades.length):null}
}
