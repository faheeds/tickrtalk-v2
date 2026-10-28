import {mean,summarize} from './model.mjs'
import {priorBarCount} from './universe-scanner.mjs'
import {sessionPriceFactor} from './nominal-prices.mjs'

export function validBar(b){return b&&[b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)&&Math.min(b.o,b.h,b.l,b.c)>0&&b.v>=0&&b.l<=Math.min(b.o,b.c)&&b.h>=Math.max(b.o,b.c)}
export function priorMetrics(adjusted,raw,date,lookback=14){
 const n=priorBarCount(adjusted,date),r=priorBarCount(raw,date)
 if(n<lookback+1||r>=raw.length||adjusted[n]?.t.slice(0,10)!==date||raw[r]?.t.slice(0,10)!==date)return null
 if(Date.parse(date)-Date.parse(adjusted[n-1].t.slice(0,10))>7*86400000)return null
 const factor=sessionPriceFactor(adjusted[n],raw[r]),recent=adjusted.slice(n-lookback,n)
 if(recent.some(b=>!validBar(b)))throw new Error('Invalid prior daily prices')
 const atr=mean(recent.map((b,i)=>{const previous=adjusted[n-lookback+i-1];return Math.max(b.h-b.l,Math.abs(b.h-previous.c),Math.abs(b.l-previous.c))}))*factor
 return {factor,atr,averageVolume:mean(recent.map(b=>b.v))/factor,averageDollarVolume:mean(recent.map(b=>b.c*b.v)),previousClose:adjusted[n-1].c*factor}
}

// Rank all eligible directions before applying the user's long-only restriction.
export function openingShortlist(records,p){
 return records.filter(r=>r.open>p.orb.minimumPriceExclusive&&r.averageVolume>=p.orb.minimumAverageVolume&&r.atr>p.orb.minimumAtrExclusive&&r.relativeVolume>=p.orb.minimumRelativeVolume)
  .sort((a,b)=>b.relativeVolume-a.relativeVolume||a.symbol.localeCompare(b.symbol)).slice(0,p.orb.shortlistSize).map((r,i)=>({...r,rank:i+1,direction:r.close>r.open?'long':r.close<r.open?'short':'doji'}))
}
export function dailyFees({buyShares=0,sellShares=0,sellNotional=0},p){
 const up=n=>n>0?Math.ceil((n-1e-10)*100)/100:0,c=p.costs
 return {sec:up(sellNotional*c.secPerDollar),taf:up(sellShares*c.tafPerShare),cat:up((buyShares+sellShares)*c.catPerShare)}
}
export const settlementLag=date=>date<'2024-05-28'?2:1

export function simulateOpening({sessions,shortlists,readSession},p,split,{slippageBps=p.costs.baselineSlippageBps,entryBarStopPolicy='assume_stop_after_entry'}={}){
 if(!['assume_stop_after_entry','defer_until_next_minute'].includes(entryBarStopPolicy))throw new Error('Unknown ambiguous entry-bar policy.')
 const capital=p.risk.capital,curve=[],trades=[],quality={missingHeldMinutes:0,missingClose:0,missingExecutionSeries:0,ambiguousEntryStops:0,deferredAmbiguousEntryStops:0,rejectedAffordability:0,untriggered:0},receivables=[]
 let cash=capital,totalPnl=0,peak=capital,intradayDrawdownPct=0
 const drag=(slippageBps+p.costs.spreadBps)/10000
 for(let dayIndex=0;dayIndex<sessions.length;dayIndex++){
  const day=sessions[dayIndex];if(day.date<split.start||day.date>split.end)continue
  for(let i=receivables.length-1;i>=0;i--)if(receivables[i].due<=dayIndex){cash+=receivables[i].amount;receivables.splice(i,1)}
  const unsettled=()=>receivables.reduce((s,r)=>s+r.amount,0),openingEquity=cash+unsettled(),rows=(shortlists[day.date]??[]).filter(s=>s.direction==='long'),series=rows.length?readSession(day.date):{},positions=new Map(),used=new Set(),marks=new Map(),totals={buyShares:0,sellShares:0,sellNotional:0},today=[]
  let paused=false
  const equity=()=>cash+unsettled()+[...positions.values()].reduce((s,h)=>s+h.qty*marks.get(h.symbol),0)
  const sell=(h,reference,minute,reason)=>{
   const price=reference*(1-drag),amount=h.qty*price,pnl=h.qty*(price-h.entry)
   receivables.push({due:dayIndex+settlementLag(day.date),amount});positions.delete(h.symbol);totals.sellShares+=h.qty;totals.sellNotional+=amount;totalPnl+=pnl
   const t={date:day.date,symbol:h.symbol,rank:h.rank,qty:h.qty,entryMinute:h.entryMinute,exitMinute:minute,entry:h.entry,exit:price,stop:h.stop,atr:h.atr,grossAfterExecutionPnl:pnl,pnl,reason,relativeVolume:h.relativeVolume};trades.push(t);today.push(t)
  }
  const maps=new Map(rows.map(r=>{if(!Array.isArray(series[r.symbol]))throw new Error('Missing raw execution series '+day.date+' '+r.symbol);if(!series[r.symbol].length)quality.missingExecutionSeries++;return [r.symbol,new Map(series[r.symbol].map(b=>[(Date.parse(b.t)-day.utcOpen)/60000,b]))]}))
  for(let m=5;m<day.minutes;m++){
   // Existing positions are marked at this minute's open before any new sizing.
   for(const h of positions.values()){const b=maps.get(h.symbol)?.get(m);if(b){if(!validBar(b))throw new Error('Invalid execution bar');marks.set(h.symbol,b.o)}}
   for(const r of rows){
    const b=maps.get(r.symbol).get(m),held=positions.get(r.symbol)
    if(!b){if(held)quality.missingHeldMinutes++;continue}if(!validBar(b))throw new Error('Invalid execution bar')
    if(held){
     if(b.o<=held.stop)sell(held,b.o,m,'stop_gap')
     else if(b.l<=held.stop)sell(held,held.stop,m,'stop')
     else if(m===day.minutes-1)sell(held,b.c,m,'session_close')
    }
   }
   // Use only current opens and completed prior minutes to pause new entries.
   if(openingEquity-equity()>=capital*p.risk.dailyLossPct/100)paused=true
   for(const r of rows){
    const b=maps.get(r.symbol).get(m)
    if(!b||used.has(r.symbol)||!(b.h>=r.high))continue
    used.add(r.symbol)
    if(paused||positions.size>=p.risk.maxPositions)continue
    const entry=Math.max(b.o,r.high)*(1+drag),distance=r.atr*p.orb.stopAtrFraction,stop=entry-distance,base=Math.min(capital,equity())
    const qty=Math.floor(Math.min(base*p.risk.riskPct/100/distance,base*p.risk.maxPositionFraction/entry,Math.max(0,cash-.10)/entry))
    if(qty<1||stop<=0){quality.rejectedAffordability++;continue}
    cash-=qty*entry;totals.buyShares+=qty;const h={...r,entry,entryMinute:m,qty,stop};positions.set(r.symbol,h);marks.set(r.symbol,entry)
    // Minute bars cannot establish whether a low preceded entry. Assume a stop
    // when both are touched, disclose this conservative ordering explicitly.
    if(b.l<=stop){quality.ambiguousEntryStops++;if(entryBarStopPolicy==='assume_stop_after_entry')sell(h,stop,m,'entry_bar_stop');else{quality.deferredAmbiguousEntryStops++;if(m===day.minutes-1)sell(h,b.c,m,'session_close')}}
    else if(m===day.minutes-1)sell(h,b.c,m,'session_close')
   }
   for(const h of positions.values()){const b=maps.get(h.symbol).get(m);if(b)marks.set(h.symbol,b.c)}
   const value=equity();peak=Math.max(peak,value);intradayDrawdownPct=Math.max(intradayDrawdownPct,(peak-value)/peak*100)
   if(openingEquity-value>=capital*p.risk.dailyLossPct/100)paused=true
  }
  quality.untriggered+=rows.filter(r=>!used.has(r.symbol)).length
  for(const h of [...positions.values()]){quality.missingClose++;sell(h,marks.get(h.symbol),day.minutes-1,'missing_close_fallback')}
  const fees=dailyFees(totals,p),fee=Object.values(fees).reduce((a,b)=>a+b,0)
  // Reserve fees from settled cash; if needed, deduct them from the day's sale
  // receivable without allowing an account to borrow.
  if(cash>=fee)cash-=fee
  else{const remainder=fee-cash;cash=0;const claim=receivables.at(-1);if(!claim||claim.amount<remainder)throw new Error('Fees cannot be funded');claim.amount-=remainder}
  totalPnl-=fee
  for(const t of today){t.fees=fee/today.length;t.pnl-=t.fees}
  const value=equity();if(cash<-.000001||Math.abs(capital+totalPnl-value)>.00001)throw new Error('Cash reconciliation failed')
  curve.push({date:day.date,equity:value,cash,unsettled:unsettled(),fees:fee})
 }
 return {...summarize(curve,trades,capital),maximumIntradayDrawdownPct:intradayDrawdownPct,slippageBps,entryBarStopPolicy,split,quality,curve,tradeLog:trades}
}

export function normalizeEarnings(row){
 if(!/^[A-Z][A-Z.]{0,9}$/.test(row.symbol??'')||!/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')||!Number.isFinite(Date.parse(row.date+'T00:00:00Z')))throw new Error('Invalid earnings identity')
 const fields=['epsActual','epsEstimated','revenueActual','revenueEstimated']
 if(fields.some(k=>row[k]!==null&&row[k]!==undefined&&!Number.isFinite(row[k])))throw new Error('Non-numeric earnings value')
 return {symbol:row.symbol,date:row.date,...Object.fromEntries(fields.map(k=>[k,row[k]??null])),lastUpdated:row.lastUpdated??null,time:typeof row.time==='string'?row.time.toLowerCase():null,confirmed:typeof row.confirmed==='boolean'?row.confirmed:null,fiscalPeriod:row.fiscalPeriod??null,fiscalYear:row.fiscalYear??null,timingVerified:false,estimatePointInTimeVerified:false,source:'FMP stable earnings'}
}
export function earningsCandidate(event,{sessions,daily,rawDaily},p){
 const r=p.earnings
 if(![event.epsActual,event.epsEstimated,event.revenueActual,event.revenueEstimated].every(Number.isFinite)||Math.abs(event.epsEstimated)<r.minimumAbsoluteEpsEstimate||event.revenueEstimated<=0)return null
 const surprise=(event.epsActual-event.epsEstimated)/Math.abs(event.epsEstimated)*100,revenue=(event.revenueActual/event.revenueEstimated-1)*100
 if(surprise<r.minimumEpsSurprisePct||revenue<r.minimumRevenueSurprisePct)return null
 const reportTime=String(event.time??'').toLowerCase(),knownBeforeOpen=reportTime==='bmo',knownAfterClose=reportTime==='amc'
 // Use provider-labelled before-market or after-market events only. If a
 // release time is missing, wait for the next complete session.
 const reactionIndex=sessions.findIndex(s=>knownBeforeOpen?s.date>=event.date:s.date>event.date)
 if(reactionIndex<0||reactionIndex+1>=sessions.length)return null
 const reaction=sessions[reactionIndex],entrySession=sessions[reactionIndex+1],i=priorBarCount(daily,reaction.date),rawIndex=priorBarCount(rawDaily,reaction.date)
 if(i<r.volumeLookback+1||daily[i]?.t.slice(0,10)!==reaction.date||rawDaily[rawIndex]?.t.slice(0,10)!==reaction.date)return null
 const metrics=priorMetrics(daily,rawDaily,reaction.date,r.volumeLookback),bar=daily[i],prior=daily[i-1],previous=daily.slice(i-r.volumeLookback,i),relativeVolume=bar.v/mean(previous.map(b=>b.v)),reactionPct=(bar.c/prior.c-1)*100
 if(!metrics||metrics.averageDollarVolume<r.minimumAverageDollarVolume||bar.c*metrics.factor<r.minimumPrice||reactionPct<r.minimumReactionPct||relativeVolume<r.minimumReactionRelativeVolume||bar.c<=bar.o)return null
 return {symbol:event.symbol,eventDate:event.date,reportTime:knownBeforeOpen?'bmo':knownAfterClose?'amc':'unknown',reactionDate:reaction.date,date:entrySession.date,surprisePct:surprise,revenueSurprisePct:revenue,reactionPct,relativeVolume,score:surprise,atr:metrics.atr,timingVerified:knownBeforeOpen||knownAfterClose,estimatePointInTimeVerified:false,source:event.source}
}
