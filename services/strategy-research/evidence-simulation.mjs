import {dailyFees,settlementLag,validBar} from './evidence-model.mjs'
import {sessionPriceFactor} from './nominal-prices.mjs'
import {summarize} from './model.mjs'

export function simulateEarnings({sessions,candidates,readDaily,readFactors},protocol,split,{slippageBps=protocol.costs.baselineSlippageBps}={}){
 const {risk}=protocol,capital=risk.capital,drag=(slippageBps+protocol.costs.spreadBps)/10000
 const calendarIndex=new Map(sessions.map((s,i)=>[s.date,i])),lastEntryIndex=(calendarIndex.get(split.end)??sessions.length-1)-(protocol.earnings.maximumHoldingSessions-1)
 const days=sessions.filter(s=>s.date>=split.start&&s.date<=split.end)
 const scheduled=new Map(),positions=new Map(),receivables=[],trades=[],curve=[]
 for(const row of candidates){if(!scheduled.has(row.date))scheduled.set(row.date,[]);scheduled.get(row.date).push(row)}
 let cash=capital,peak=capital,maximumPeakDrawdownPct=0
 const quality={missingDailyBars:0,invalidSplitScales:0,splitAdjustments:0,cashInLieuEvents:0,unclosedAtEnd:0,unaffordableSignals:0,unfilledEvents:0}
 const unsettled=()=>receivables.reduce((sum,item)=>sum+item.amount,0)
 const equity=()=>cash+unsettled()+[...positions.values()].reduce((sum,p)=>sum+p.qty*p.mark,0)
 for(const [dayIndex,session] of days.entries()){
  const globalIndex=calendarIndex.get(session.date)
  for(let i=receivables.length-1;i>=0;i--)if(receivables[i].due<=globalIndex){cash+=receivables[i].amount;receivables.splice(i,1)}
  const dayStart=equity(),bars=new Map(),todayFees={buyShares:0,sellShares:0,sellNotional:0},feeWeights=[]
  const getBar=symbol=>{if(!bars.has(symbol))bars.set(symbol,readDaily(symbol,session.date));return bars.get(symbol)}
  const closePosition=(position,reference,reason)=>{
   const fill=reason==='stop'?position.stop:reference
   const price=fill*(1-drag),proceeds=position.qty*price
   receivables.push({due:globalIndex+settlementLag(session.date),amount:proceeds})
   todayFees.sellShares+=position.qty;todayFees.sellNotional+=proceeds
   feeWeights.push({trade:position.trade,notional:proceeds})
   position.trade.grossPnl=position.realizedGross+position.qty*(price-position.entry)
   position.trade.reason=reason;position.trade.exitDate=session.date;position.trade.exit=price;position.trade.closed=true
   positions.delete(position.symbol)
  }
  for(const position of [...positions.values()]){
   const bar=getBar(position.symbol)
   if(!bar||!validBar(bar)){quality.missingDailyBars++;continue}
   const previousFactor=position.priceFactor
   const currentFactor=readFactors(position.symbol,session.date)
   if(!Number.isFinite(currentFactor)||currentFactor<=0){quality.invalidSplitScales++;position.mark=bar.c;continue}
   if(!Number.isFinite(previousFactor)||previousFactor<=0){quality.invalidSplitScales++;position.priceFactor=currentFactor}
   else if(Math.abs(previousFactor-currentFactor)>1e-8){
    const ratio=previousFactor/currentFactor,newShares=position.qty*ratio,whole=Math.floor(newShares+1e-10),fraction=newShares-whole,open=bar.o
    position.entry/=ratio;position.stop/=ratio
    position.realizedGross+=(fraction?fraction*(open*(1-drag)-position.entry):0)
    position.qty=whole;position.priceFactor=currentFactor;quality.splitAdjustments++
    if(fraction>1e-8){const amount=fraction*open*(1-drag);receivables.push({due:globalIndex+settlementLag(session.date),amount});todayFees.sellShares+=fraction;todayFees.sellNotional+=amount;feeWeights.push({trade:position.trade,notional:amount});quality.cashInLieuEvents++}
    if(whole===0){position.trade.grossPnl=position.realizedGross;position.trade.reason='split_cash_in_lieu';position.trade.exitDate=session.date;position.trade.exit=open;position.trade.closed=true;positions.delete(position.symbol);continue}
   }
   position.mark=bar.c
   if(bar.o<=position.stop)closePosition(position,bar.o,'stop_gap')
   else if(bar.l<=position.stop)closePosition(position,position.stop,'stop')
   else if(globalIndex-position.entryIndex>=protocol.earnings.maximumHoldingSessions-1)closePosition(position,bar.c,'maximum_holding_period')
  }
  let filled=0
  const candidatesToday=(globalIndex<=lastEntryIndex?(scheduled.get(session.date)??[]):[]).slice().sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))
  let dayHalted=false
  for(const candidate of candidatesToday){
   if(dayHalted||positions.size>=risk.maxPositions||filled>=risk.maxTradesPerDay||positions.has(candidate.symbol))continue
   const bar=getBar(candidate.symbol)
   if(!bar||!validBar(bar)){quality.missingDailyBars++;continue}
   const entry=bar.o*(1+drag),distance=candidate.atr*protocol.earnings.stopAtrMultiple,stop=entry-distance,base=Math.min(capital,equity())
   if(!(entry>0&&distance>0&&stop>0)){quality.unaffordableSignals++;continue}
   const factor=readFactors(candidate.symbol,session.date)
   if(!Number.isFinite(factor)||factor<=0){quality.invalidSplitScales++;continue}
   const qty=Math.floor(Math.min(base*risk.riskPct/100/distance,base*risk.maxPositionFraction/entry,Math.max(0,cash-.01)/entry))
   if(qty<1){quality.unaffordableSignals++;continue}
   cash-=qty*entry
   const trade={symbol:candidate.symbol,eventDate:candidate.eventDate,reactionDate:candidate.reactionDate,date:session.date,reportTime:candidate.reportTime,qty,entry,stop,atr:candidate.atr,surprisePct:candidate.surprisePct,reactionPct:candidate.reactionPct,relativeVolume:candidate.relativeVolume,grossPnl:null,fees:0,pnl:null,closed:false,estimatePointInTimeVerified:false}
   trades.push(trade);todayFees.buyShares+=qty;feeWeights.push({trade,notional:qty*entry})
   const position={symbol:candidate.symbol,qty,entry,stop,mark:bar.c,entryIndex:globalIndex,priceFactor:factor,realizedGross:0,trade}
   positions.set(candidate.symbol,position);filled++
   // Daily OHLC cannot tell whether the low came before the open fill. Assume
   // the stop was hit after entry when both conditions occur on this day.
   if(bar.l<=stop)closePosition(position,stop,'entry_day_stop')
   if(dayStart-equity()>=capital*risk.dailyLossPct/100)dayHalted=true
  }
  if(dayStart-equity()>=capital*risk.dailyLossPct/100)dayHalted=true
  const fees=dailyFees(todayFees,protocol),totalFee=fees.sec+fees.taf+fees.cat
  if(totalFee>cash){const shortage=totalFee-cash,claim=receivables.at(-1);if(!claim||claim.amount<shortage)throw new Error('Regulatory fees cannot be funded from cash proceeds.');claim.amount-=shortage;cash=0}else cash-=totalFee
  const totalWeight=feeWeights.reduce((sum,item)=>sum+item.notional,0)
  if(totalWeight>0)for(const item of feeWeights)item.trade.fees+=totalFee*item.notional/totalWeight
  for(const trade of trades)if(trade.closed)trade.pnl=trade.grossPnl-trade.fees
  const value=equity();peak=Math.max(peak,value);maximumPeakDrawdownPct=Math.max(maximumPeakDrawdownPct,(peak-value)/peak*100)
  if(cash<-.000001||Math.abs(cash+unsettled()+[...positions.values()].reduce((sum,p)=>sum+p.qty*p.mark,0)-value)>.00001)throw new Error('Cash account reconciliation failed.')
  curve.push({date:session.date,equity:value,cash,unsettled:unsettled()})
 }
 quality.unclosedAtEnd=positions.size
 const closed=trades.filter(t=>t.closed)
 return {...summarize(curve,closed,capital),slippageBps,split,curve,tradeLog:closed,openPositions:[...positions.values()].map(p=>({symbol:p.symbol,qty:p.qty,mark:p.mark})),quality,maximumPeakDrawdownPct}
}

export function verifyResearchInputs(candidates,protocolBytes,expectedProtocolHash){
 if(candidates.protocolHash!==expectedProtocolHash)throw new Error('Candidate file uses a different research protocol.')
 if(!Buffer.isBuffer(protocolBytes)||protocolBytes.length===0)throw new Error('Research protocol bytes are missing.')
 return true
}

export function splitFactor(adjusted,raw){
 if(!adjusted||!raw)return null
 return sessionPriceFactor(adjusted,raw)
}
