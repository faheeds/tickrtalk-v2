import {sizeOrder,exitFill,summarize} from './model.mjs'
export function exitBroadFill(position,bar,costs,minute,closeMinute,risk){
 // A resting protective order crossed at the opening print precedes later bar movement.
 if(bar.o<=position.stop)return {price:bar.o*(1-(costs.slippageBps+costs.spreadBps)/10000),fee:position.qty*costs.sellFeePerShare,reason:'stop_gap'}
 if(bar.o>=position.target)return {price:position.target,fee:position.qty*costs.sellFeePerShare,reason:'target_gap'}
 return exitFill(position,bar,costs,minute,closeMinute,risk)
}
export function simulateBroad({sessions,signals,readSession},parameters,protocol,split,{slippageBps=protocol.costs.baselineSlippageBps}={}){
 const risk=protocol.risk,capital=risk.capital,costs={...protocol.costs,slippageBps},curve=[],trades=[],positions=new Map(),pending=new Map(),marks=new Map(),diagnostics={missingCloseBars:0,missingHoldingBars:0,ambiguousBars:0,invalidEntryGaps:0,expiredOrders:0,haltDate:null}
 let cash=capital,unsettled=0,peak=capital,halted=false
 const equity=()=>cash+unsettled+[...positions.values()].reduce((s,p)=>s+p.qty*marks.get(p.symbol),0)
 for(const session of sessions.filter(s=>s.date>=split.start&&s.date<=split.end)){
  cash+=unsettled;unsettled=0
  const openingValue=equity(),scheduled=signals.filter(s=>s.date===session.date&&s.setup===parameters.setup&&s.arms.includes(parameters.arm)),series=scheduled.length?readSession(session.date):{},byMinute=new Map()
  for(const signal of scheduled){if(!byMinute.has(signal.minute))byMinute.set(signal.minute,[]);byMinute.get(signal.minute).push(signal);if(!Array.isArray(series[signal.symbol]))throw new Error('Minute execution history missing: '+session.date+' '+signal.symbol)}
  const bars=new Map(Object.entries(series).map(([symbol,rows])=>[symbol,new Map(rows.map(b=>[(Date.parse(b.t)-session.utcOpen)/60000,b]))]))
  let filled=0,paused=false
  const sell=(p,fill,m)=>{const pnl=p.qty*(fill.price-p.entry)-fill.fee;unsettled+=p.qty*fill.price-fill.fee;positions.delete(p.symbol);trades.push({date:session.date,symbol:p.symbol,qty:p.qty,entryMinute:p.entryMinute,exitMinute:m,entry:p.entry,exit:fill.price,pnl,reason:fill.reason,setup:parameters.setup,arm:parameters.arm})}
  for(let m=0;m<session.minutes;m++){
   // All signals here come from a completed coarse bar ending before minute m.
   if(!paused&&!halted){for(const signal of (byMinute.get(m)??[]).sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))){
    if(positions.size+pending.size>=risk.maxPositions||filled+pending.size>=risk.maxTradesPerDay)break
    if(positions.has(signal.symbol)||pending.has(signal.symbol))continue
    const reserved=[...pending.values()].reduce((s,p)=>s+p.qty*p.limit,0),order=sizeOrder(signal,{cash,reserved,equity:equity(),capital,risk})
    if(order)pending.set(signal.symbol,{...order,expires:m+risk.entryExpiryMinutes})
   }}
   for(const symbol of [...new Set([...positions.keys(),...pending.keys()])].sort()){
    const bar=bars.get(symbol)?.get(m);if(!bar){if(positions.has(symbol))diagnostics.missingHoldingBars++;continue}
    if(![bar.o,bar.h,bar.l,bar.c].every(Number.isFinite)||bar.l<=0||bar.l>Math.min(bar.o,bar.c)||bar.h<Math.max(bar.o,bar.c))throw new Error('Invalid execution bar.')
    marks.set(symbol,bar.o);let held=positions.get(symbol)
    if(held){const fill=exitBroadFill(held,bar,costs,m,session.minutes,risk);if(fill){if(fill.reason==='stop_before_target')diagnostics.ambiguousBars++;sell(held,fill,m)}else if(bar.c>=held.entry+held.initialRisk)held.stop=Math.max(held.stop,Math.floor(held.entry*100)/100)}
    const order=pending.get(symbol)
    if(order){
     if(m>=order.expires||paused||halted){pending.delete(symbol);diagnostics.expiredOrders++}
     else if(bar.o<=order.stop){pending.delete(symbol);diagnostics.invalidEntryGaps++}
     else if(bar.l<=order.limit){
      const price=Math.min(order.limit,bar.o*(1+(slippageBps+costs.spreadBps)/10000)),notional=order.qty*price
      if(notional<=cash+1e-8){cash-=notional;held={...order,entry:price,entryMinute:m,initialRisk:price-order.stop};positions.set(symbol,held);marks.set(symbol,price);pending.delete(symbol);filled++
       if(bar.l<=held.stop){diagnostics.ambiguousBars+=bar.h>=held.target?1:0;sell(held,{price:held.stop*(1-(slippageBps+costs.spreadBps)/10000),fee:held.qty*costs.sellFeePerShare,reason:'entry_bar_stop'},m)}
      }
     }
    }
    marks.set(symbol,bar.c)
   }
   const value=equity();peak=Math.max(peak,value)
   if(openingValue-value>=capital*risk.dailyLossPct/100){paused=true;pending.clear()}
   if((peak-value)/peak*100>=risk.maxAccountDrawdownPct){halted=true;diagnostics.haltDate??=session.date;pending.clear()}
  }
  for(const held of [...positions.values()]){diagnostics.missingCloseBars++;sell(held,{price:marks.get(held.symbol)*(1-(slippageBps+costs.spreadBps)/10000),fee:held.qty*costs.sellFeePerShare,reason:'missing_close_fallback'},session.minutes-1)}
  pending.clear();const value=equity();if(cash<-.000001||unsettled<-.000001||Math.abs(capital+trades.reduce((s,t)=>s+t.pnl,0)-value)>.00001)throw new Error('Cash ledger reconciliation failed.')
  curve.push({date:session.date,equity:value,cash,unsettled})
 }
 return {...summarize(curve,trades,capital),parameters,split,slippageBps,curve,tradeLog:trades,diagnostics}
}
