import {median,mean,cents} from './model.mjs'
import {priorEligibility,shortlist,priorBarCount} from './universe-scanner.mjs'
import {sessionPriceFactor,nominalSession,nominalFeatures} from './nominal-prices.mjs'
export function historicalFeatures(daily,date){
 const count=priorBarCount(daily,date)
 if(count<51)return null
 const ranges=daily.slice(count-14,count).map((b,j)=>{const p=daily[count-14+j-1];return Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c))})
 return {previousClose:daily[count-1].c,sma20:mean(daily.slice(count-20,count).map(b=>b.c)),sma50:mean(daily.slice(count-50,count).map(b=>b.c)),atr:mean(ranges)}
}
export function sessionBars(raw,session){
 const result=raw.filter(b=>{const offset=(Date.parse(b.t)-session.utcOpen)/60000;return Number.isInteger(offset)&&offset>=0&&offset<session.minutes&&offset%15===0}).map(b=>({...b,minute:(Date.parse(b.t)-session.utcOpen)/60000}))
 for(let i=1;i<result.length;i++)if(result[i].minute<=result[i-1].minute)throw new Error('Duplicate or unsorted morning bars.')
 let tpv=0,volume=0
 for(const b of result){if(![b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||Math.min(b.o,b.h,b.l,b.c)<=0||b.v<0||b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c))throw new Error('Invalid coarse market bar');tpv+=(b.h+b.l+b.c)/3*b.v;volume+=b.v;b.vwap=volume?tpv/volume:NaN}
 return result
}
export function openingStatistics(coarse,calendar){
 const days=new Map(),byDate=new Map(),history=[]
 for(const b of coarse){const date=b.t.slice(0,10);if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(b)}
 for(const session of calendar){
  const bars=sessionBars(byDate.get(session.date)??[],session),opening=bars.find(b=>b.minute===0),typical=history.length>=15?median(history.slice(-20)):NaN
  days.set(session.date,{bars,opening,relativeVolume:opening&&typical>0?opening.v/typical:NaN})
  if(opening?.v>0)history.push(opening.v)
 }
 return days
}
export function signalsForSession({symbol,day,market,features,marketFeatures,protocol}){
 const result=[],orb=day.opening,risk=protocol.risk
 if(!orb||!features||!marketFeatures||!(features.previousClose>features.sma20&&marketFeatures.previousClose>marketFeatures.sma50&&features.atr>0&&day.relativeVolume>=protocol.signalRules.minimumOpeningRelativeVolume))return result
 const gap=orb.o/features.previousClose-1,width=(orb.h-orb.l)/features.atr
 if(Math.abs(gap)>.05||width<protocol.signalRules.minimumRangeAtr||width>protocol.signalRules.maximumRangeAtr)return result
 const spyOpen=market.opening?.o,spy=new Map(market.bars.map(b=>[b.minute,b])),bars=new Map(day.bars.map(b=>[b.minute,b])),emitted=new Set()
 for(const b of day.bars){
  if(b.minute<15||b.minute+15>90)continue
  const previous=bars.get(b.minute-15),benchmark=spy.get(b.minute)
  if(!previous||!benchmark||!(benchmark.c>benchmark.vwap)||!spyOpen||b.c<protocol.eligibility.minimumPrice)continue
  const setups=[]
  if(orb.c>orb.o&&gap>=0&&previous.c<=orb.h&&b.c>orb.h&&b.c>b.o&&b.c>b.vwap&&b.c<=orb.h+features.atr*.25&&b.c<=b.vwap+features.atr*.75&&b.c/orb.o>benchmark.c/spyOpen)setups.push('morning_breakout')
  if(orb.c<orb.o&&orb.l<=features.previousClose-features.atr*.25&&previous.c<=previous.vwap&&b.c>b.vwap&&b.c>previous.h&&b.c>b.o&&b.c>orb.o)setups.push('vwap_reclaim')
  for(const setup of setups){
   if(emitted.has(setup))continue
   const limit=cents(b.c*(1+risk.maxEntrySlipPct/100)),stop=Math.floor(Math.min(b.l,previous.l)*100)/100,distance=limit-stop,stopPct=distance/limit*100
   if(stop<=0||stopPct<risk.minStopPct||stopPct>risk.maxStopPct)continue
   result.push({symbol,setup,signalMinute:b.minute+14,minute:b.minute+15,limit,stop,target:cents(limit+protocol.signalRules.targets[setup]*distance),score:day.relativeVolume*(1+Math.abs(gap)),relativeVolume:day.relativeVolume,gapPct:gap*100,reason:setup==='morning_breakout'?'Completed morning breakout with market trend and relative strength.':'Completed VWAP reclaim after an opening selloff.'});emitted.add(setup)
  }
 }
 return result
}
export function buildSymbolResearch({stock,daily,rawDaily,coarse,rawMorningByDate,calendar,marketDays,marketDaily,marketFactors,protocol,sp500}){
 const days=openingStatistics(coarse,calendar),records=[],signals=[],auditExclusions=[],adjustedByDate=new Map(daily.map(b=>[b.t.slice(0,10),b])),rawByDate=new Map(rawDaily.map(b=>[b.t.slice(0,10),b]))
 for(const session of calendar.filter(d=>d.date>=protocol.period.start&&d.date<=protocol.period.end)){
  const adjustedDay=days.get(session.date),market=marketDays.get(session.date)
  if(!adjustedDay?.opening||!market?.opening)continue
  const eligibility=priorEligibility(rawDaily,session.date,protocol.eligibility)
  if(!eligibility.eligible)continue
  let factor
  try{factor=sessionPriceFactor(adjustedByDate.get(session.date),rawByDate.get(session.date))}catch(error){auditExclusions.push({symbol:stock.symbol,date:session.date,reason:error.message});continue}
  let day
  const rawBars=rawMorningByDate.get(session.date)?.[stock.symbol]
  if(Array.isArray(rawBars)){const bars=sessionBars(rawBars,session);day={...adjustedDay,bars,opening:bars.find(b=>b.minute===0)}}else if(Math.abs(factor-1)>.00000001)throw new Error('Raw split-affected morning is missing: '+stock.symbol+' '+session.date);else day=nominalSession(adjustedDay,factor)
  if(!day.opening)continue
  const features=nominalFeatures(historicalFeatures(daily,session.date),factor),marketFeatures=nominalFeatures(historicalFeatures(marketDaily,session.date),marketFactors.get(session.date))
  if(day.opening.o<protocol.eligibility.minimumPrice||!features)continue
  const record={date:session.date,symbol:stock.symbol,eligible:true,previousClose:features.previousClose,averageDollarVolume:eligibility.averageDollarVolume,relativeVolume:Number.isFinite(day.relativeVolume)?day.relativeVolume:null,gapPct:(day.opening.o/features.previousClose-1)*100,sp500:sp500.has(stock.symbol),screeningStatus:'unverified',catalystStatus:'unverified'}
  records.push(record)
  signals.push(...signalsForSession({symbol:stock.symbol,day,market,features,marketFeatures,protocol}).map(s=>({...s,date:session.date,sp500:record.sp500})))
 }
 return {records,signals,auditExclusions}
}
export function assignArms(records,signals,protocol){
 const byDate=new Map(),shortlists={}
 for(const record of records){if(!byDate.has(record.date))byDate.set(record.date,[]);byDate.get(record.date).push(record)}
 for(const [date,rows]of byDate)shortlists[date]=shortlist(rows,protocol.scanner)
 return {signals:signals.map(s=>({...s,arms:[...(s.sp500?['sp500']:[]),'broad_liquid',...(shortlists[s.date]?.some(r=>r.symbol===s.symbol)?['daily_opportunities']:[])]})),shortlists}
}
