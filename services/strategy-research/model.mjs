// Research functions have no broker client, credential access or order submission path.
export const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0
export const median=a=>{const b=[...a].sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length?(b.length%2?b[m]:(b[m-1]+b[m])/2):NaN}
export const cents=n=>Math.round((n+Number.EPSILON)*100)/100
export function variants(grid){const result=[];for(const setup of grid.setup)for(const openingMinutes of grid.openingMinutes)for(const relativeVolume of grid.relativeVolume)for(const rewardR of grid.rewardR)result.push({id:`${setup}-${openingMinutes}-v${relativeVolume}-r${rewardR}`,setup,openingMinutes,relativeVolume,rewardR});return result}
export function opening(day,n){
 let high=-Infinity,low=Infinity,volume=0
 for(let i=0;i<n;i++){if(!Number.isFinite(day.c[i]))return null;high=Math.max(high,day.h[i]);low=Math.min(low,day.l[i]);volume+=day.v[i]}
 return {high,low,volume,close:day.c[n-1]}
}
export function candidateSignals(day,market,parameters,risk){
 const result=new Map(),n=parameters.openingMinutes,orb=opening(day,n),f=day.features,benchmark=market?.features
 if(!orb||!f||!benchmark||!(f.previousClose>f.sma20&&benchmark.previousClose>benchmark.sma50&&f.atr>0&&f.gap>=0&&f.gap<=.03))return result
 const typical=day.openingHistory[n]
 if(!(typical>0&&orb.volume/typical>=parameters.relativeVolume&&orb.close>day.o[0]&&(orb.high-orb.low)/f.atr>=.1&&(orb.high-orb.low)/f.atr<=.8))return result
 let brokeAt=-1,retested=false
 for(let i=n;i<Math.min(90,day.c.length-10);i++){
  const close=day.c[i],previous=day.c[i-1]
  if(!Number.isFinite(close)||!Number.isFinite(previous)||!Number.isFinite(market.c[i]))continue
  if(brokeAt>=0&&i>brokeAt&&day.l[i]<=orb.high+f.atr*.1)retested=true
  const breakout=previous<=orb.high&&close>orb.high
  const setup=parameters.setup==='breakout'?breakout:brokeAt>=0&&i>brokeAt&&retested&&close>orb.high&&close>day.h[i-1]
  if(brokeAt<0&&close>orb.high)brokeAt=i
  if(!setup||close<=day.o[i]||close<=day.vwap[i]||close>orb.high+f.atr*.2||close>day.vwap[i]+f.atr*.5)continue
  if(!(market.c[i]>market.vwap[i]&&market.c[i]>market.o[0]&&market.c[i]>=market.c[Math.max(0,i-3)]))continue
  const strength=close/day.o[0]-market.c[i]/market.o[0]
  if(strength<=0)continue
  let stop=Infinity,valid=true
  for(let j=i-4;j<=i;j++){if(!Number.isFinite(day.l[j])){valid=false;break}stop=Math.min(stop,day.l[j])}
  stop=Math.floor(stop*100)/100
  const limit=cents(close*(1+risk.maxEntrySlipPct/100)),distance=limit-stop,stopPct=distance/limit*100
  if(!valid||stopPct<risk.minStopPct||stopPct>risk.maxStopPct)continue
  result.set(i+1,{symbol:day.symbol,minute:i+1,signalMinute:i,limit,stop,target:cents(limit+parameters.rewardR*distance),score:orb.volume/typical*(1+strength*100)})
  // One opportunity per stock per session. A missed fill is not chased.
  break
 }
 return result
}
export function sizeOrder(signal,{cash,reserved=0,equity,capital,risk}){
 if(!(signal.stop>0&&signal.stop<signal.limit&&signal.target>signal.limit&&cash>=0&&equity>0&&capital>0))return null
 const qty=Math.floor(Math.min(Math.min(capital,equity)*risk.riskPct/100/(signal.limit-signal.stop),Math.min(capital,equity)*risk.maxPositionFraction/signal.limit,(cash-reserved)/signal.limit))
 return qty>=1?{...signal,qty}:null
}
export function exitFill(position,bar,{slippageBps,spreadBps,sellFeePerShare},minute,closeMinute,risk){
 const factor=1-(slippageBps+spreadBps)/10000
 const market=(reference,reason)=>({price:reference*factor,reason,fee:position.qty*sellFeePerShare})
 if(minute>=closeMinute-risk.flattenMinutes)return market(bar.o,'session_close')
 if(minute-position.entryMinute>=risk.maxHoldingMinutes)return market(bar.o,'time_exit')
 if(bar.o<=position.stop)return market(bar.o,'stop_gap')
 if(bar.l<=position.stop)return market(position.stop,bar.h>=position.target?'stop_before_target':'stop')
 if(bar.h>=position.target)return {price:position.target,reason:'target',fee:position.qty*sellFeePerShare}
 return null
}
export function summarize(curve,trades,capital){
 const endingValue=curve.at(-1)?.equity??capital,pnl=endingValue-capital,wins=trades.filter(t=>t.pnl>0),profits=wins.reduce((s,t)=>s+t.pnl,0),losses=-trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0)
 let peak=capital,drawdown=0,previous=capital;const dailyReturns=[],months={}
 for(const day of curve){peak=Math.max(peak,day.equity);drawdown=Math.max(drawdown,(peak-day.equity)/peak*100);dailyReturns.push((day.equity-previous)/previous);const month=day.date.slice(0,7);months[month]??={pnl:0,trades:0};months[month].pnl+=day.equity-previous;previous=day.equity}
 for(const trade of trades)months[trade.date.slice(0,7)].trades++
 const active=Object.values(months).filter(m=>m.trades>0),average=mean(dailyReturns),stdev=Math.sqrt(mean(dailyReturns.map(x=>(x-average)**2)))
 return {capital,endingValue:cents(endingValue),pnl:cents(pnl),returnPct:cents(pnl/capital*100),trades:trades.length,winRatePct:trades.length?cents(wins.length/trades.length*100):null,profitFactor:losses?profits/losses:profits?null:0,noLosses:losses===0&&profits>0,maximumDailyDrawdownPct:cents(drawdown),activeMonths:active.length,positiveActiveMonthFraction:active.length?active.filter(m=>m.pnl>0).length/active.length:0,score:stdev?average/stdev:0,months,dailyReturns}
}
export function simulate(marketData,parameters,protocol,split,{slippageBps=protocol.costs.baselineSlippageBps}={}){
 const {risk}=protocol,capital=risk.capital,costs={...protocol.costs,slippageBps},days=marketData.calendar.filter(d=>d.date>=split.start&&d.date<=split.end)
 let cash=capital,unsettled=0,peak=capital,halted=false;const curve=[],trades=[],diagnostics={invalidEntryGaps:0,expiredOrders:0,missingCloseBars:0,ambiguousBars:0,haltDate:null},positions=new Map(),pending=new Map(),marks=new Map()
 const equity=()=>cash+unsettled+[...positions.values()].reduce((s,p)=>s+p.qty*marks.get(p.symbol),0)
 for(const session of days){
  cash+=unsettled;unsettled=0;const dayStart=equity(),signals=new Map();let filled=0,paused=false
  for(const symbol of protocol.symbols){const day=marketData.series.get(symbol)?.get(session.date),market=marketData.series.get(protocol.marketProxy)?.get(session.date);if(!day||!market)continue;for(const [m,s]of candidateSignals(day,market,parameters,risk)){if(!signals.has(m))signals.set(m,[]);signals.get(m).push(s)}}
  const sell=(p,fill,m)=>{const pnl=p.qty*(fill.price-p.entry)-fill.fee;unsettled+=p.qty*fill.price-fill.fee;positions.delete(p.symbol);trades.push({date:session.date,symbol:p.symbol,qty:p.qty,entryMinute:p.entryMinute,exitMinute:m,entry:p.entry,exit:fill.price,pnl,reason:fill.reason})}
  for(let m=0;m<session.minutes;m++){
   for(const symbol of protocol.symbols){
    const day=marketData.series.get(symbol)?.get(session.date);if(!day||!Number.isFinite(day.c[m]))continue
    const bar={o:day.o[m],h:day.h[m],l:day.l[m],c:day.c[m]};marks.set(symbol,bar.o)
    let held=positions.get(symbol)
    if(held){const fill=exitFill(held,bar,costs,m,session.minutes,risk);if(fill){if(fill.reason==='stop_before_target')diagnostics.ambiguousBars++;sell(held,fill,m)}else if(bar.c>=held.entry+held.initialRisk){held.stop=Math.max(held.stop,cents(held.entry))}}
    const order=pending.get(symbol)
    if(order){
     if(m>=order.expires||paused||halted){pending.delete(symbol);diagnostics.expiredOrders++}
     else if(bar.o<=order.stop){pending.delete(symbol);diagnostics.invalidEntryGaps++}
     else if(bar.l<=order.limit){
      const price=Math.min(order.limit,bar.o*(1+(slippageBps+costs.spreadBps)/10000)),notional=order.qty*price
      if(notional<=cash+1e-8){cash-=notional;held={...order,entry:price,entryMinute:m,initialRisk:price-order.stop};positions.set(symbol,held);pending.delete(symbol);filled++
       if(bar.l<=held.stop){diagnostics.ambiguousBars+=bar.h>=held.target?1:0;sell(held,{price:held.stop*(1-(slippageBps+costs.spreadBps)/10000),fee:held.qty*costs.sellFeePerShare,reason:'entry_bar_stop'},m)}
      }
     }
    }
    marks.set(symbol,bar.c)
   }
   const current=equity();peak=Math.max(peak,current)
   if(dayStart-current>=capital*risk.dailyLossPct/100){paused=true;pending.clear()}
   if((peak-current)/peak*100>=risk.maxAccountDrawdownPct){halted=true;diagnostics.haltDate??=session.date;pending.clear()}
   if(paused||halted||filled+pending.size>=risk.maxTradesPerDay)continue
   for(const signal of (signals.get(m+1)??[]).sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))){
    if(positions.size+pending.size>=risk.maxPositions||filled+pending.size>=risk.maxTradesPerDay)break
    if(positions.has(signal.symbol)||pending.has(signal.symbol))continue
    const reserved=[...pending.values()].reduce((s,p)=>s+p.qty*p.limit,0),order=sizeOrder(signal,{cash,reserved,equity:current,capital,risk})
    if(order)pending.set(signal.symbol,{...order,expires:m+1+risk.entryExpiryMinutes})
   }
  }
  for(const held of [...positions.values()]){diagnostics.missingCloseBars++;sell(held,{price:marks.get(held.symbol)*(1-(slippageBps+costs.spreadBps)/10000),fee:held.qty*costs.sellFeePerShare,reason:'missing_close_fallback'},session.minutes-1)}
  pending.clear();const closing=equity();if(cash<-.000001||unsettled<-.000001)throw new Error('Cash ledger became negative.')
  if(Math.abs(capital+trades.reduce((s,t)=>s+t.pnl,0)-closing)>.00001)throw new Error('Trade ledger does not reconcile.')
  curve.push({date:session.date,equity:closing,cash,unsettled})
 }
 return {...summarize(curve,trades,capital),parameters,split,slippageBps,curve,tradeLog:trades,diagnostics}
}
export function qualification(result,phase,protocol){
 const q=protocol.qualification,reasons=[]
 if(result.trades<q[phase+'Trades'])reasons.push('insufficient trades')
 if(result.pnl<=0)reasons.push('nonpositive net profit')
 if(!(result.profitFactor>=q[phase+'ProfitFactor']||result.noLosses))reasons.push('profit factor below threshold')
 if(result.maximumDailyDrawdownPct>q.maximumDailyDrawdownPct)reasons.push('drawdown exceeds threshold')
 if(result.activeMonths<q.minimumActiveMonths[phase])reasons.push('insufficient active months')
 if(result.positiveActiveMonthFraction<q.minimumPositiveActiveMonthFraction)reasons.push('insufficient monthly consistency')
 if(result.diagnostics.missingCloseBars>0)reasons.push('unreliable closeout data')
 return {passed:reasons.length===0,reasons}
}
export function blockBootstrapInterval(returns,{replicates=2000,block=5,seed=71237}={}){
 if(returns.length<block)return null
 const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296},means=[]
 for(let k=0;k<replicates;k++){let sum=0,count=0;while(count<returns.length){const start=Math.floor(random()*(returns.length-block+1));for(let j=0;j<block&&count<returns.length;j++,count++)sum+=returns[start+j]}means.push(sum/count)}
 means.sort((a,b)=>a-b);return {lowerDailyMean:means[Math.floor(replicates*.05)],upperDailyMean:means[Math.floor(replicates*.95)],confidence:.9,block,replicates,seed:71237}
}
