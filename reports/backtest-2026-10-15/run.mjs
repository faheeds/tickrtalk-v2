import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import assert from 'node:assert/strict'
import {evaluate,eastern,round,sizeEntry} from '../../services/paper/core.mjs'
const root='.local-run/backtest/',meta=JSON.parse(readFileSync(root+'config.json')),cfg=meta.config
const sessions=meta.calendar.filter(d=>d.date>=meta.start&&d.date<=meta.end),symbols=meta.symbols
const minute=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5))
const dataset={},coverage=[];let oracleChecks=0,negativeOracleChecks=0
for(const symbol of symbols){
 const raw=JSON.parse(readFileSync(root+symbol+'-1Min.json')),daily=JSON.parse(readFileSync(root+symbol+'-1Day.json')).map(b=>({date:new Date(b.t),open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v})),byDate=new Map()
 for(const b of raw){const date=b.t.slice(0,10);if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(b)}
 const days=new Map();let missingOrb=0,totalBars=0,symbolChecks=0,symbolNegativeChecks=0,swingSignals=0
 for(const session of sessions){
  const open=minute(session.open),close=minute(session.close),offset=16*60-eastern(session.date+'T16:00:00Z').minutes
  const bars=(byDate.get(session.date)??[]).map(b=>({...b,m:new Date(b.t).getUTCHours()*60+new Date(b.t).getUTCMinutes()-offset})).filter(b=>b.m>=open&&b.m<close)
  totalBars+=bars.length
  const orb=bars.filter(b=>b.m<open+cfg.day.orbMinutes),valid=orb.length===cfg.day.orbMinutes&&orb.every((b,i)=>b.m===open+i)
  if(!valid)missingOrb++
  const high=valid?Math.max(...orb.map(b=>b.h)):0,low=valid?Math.min(...orb.map(b=>b.l)):0,width=high-low,avg=valid?orb.reduce((a,b)=>a+b.v,0)/orb.length:0
  let tpv=0,vol=0,previous=null;const signals=new Map(),barMap=new Map()
  for(const b of bars){
   tpv+=(b.h+b.l+b.c)/3*b.v;vol+=b.v;barMap.set(b.m,b)
   if(valid&&b.m>=open+cfg.day.orbMinutes&&width>0&&avg>0&&previous?.c<=high*1.002&&b.c>high&&b.v>avg*cfg.day.volumeFactor&&b.c>tpv/vol){
    const signal={side:'buy',price:b.c,stop:round(Math.max(low,high-width*.5)),target:round(b.c+width*cfg.day.rewardMultiple),bar:b.t}
    signals.set(b.m+1,signal)
    if(symbolChecks<20){const exact=evaluate('day',bars.filter(x=>x.m<=b.m).map(x=>({date:new Date(x.t),open:x.o,high:x.h,low:x.l,close:x.c,volume:x.v})),cfg.day,{openMinute:open});assert.ok(exact);assert.equal(exact.stop,signal.stop);assert.equal(exact.target,signal.target);oracleChecks++;symbolChecks++}
   }
   if(!signals.has(b.m+1)&&b.m>=open+cfg.day.orbMinutes&&symbolNegativeChecks<20){const exact=evaluate('day',bars.filter(x=>x.m<=b.m).map(x=>({date:new Date(x.t),open:x.o,high:x.h,low:x.l,close:x.c,volume:x.v})),cfg.day,{openMinute:open});assert.equal(exact,null);symbolNegativeChecks++;negativeOracleChecks++}
   previous=b
  }
  const history=daily.filter(b=>b.date.toISOString().slice(0,10)<session.date&&b.date>=new Date(new Date(session.date)-500*86400000))
  const swing=evaluate('swing',history,cfg.swing,{openMinute:open});if(swing)swingSignals++
  days.set(session.date,{bars:barMap,signals,swing,open,close,daily:daily.find(b=>b.date.toISOString().slice(0,10)===session.date)})
 }
 dataset[symbol]=days;coverage.push({symbol,sessions:sessions.length,regularMinuteBars:totalBars,missingOpeningRangeSessions:missingOrb,swingSignals,noRegularBarsSessions:[...days.values()].filter(d=>!d.bars.size).length})
}
function simulate(style,universe,{slippageBps=5,persistentHalt=true,capital=style==='day'?2000:3500}={}){
 const slip=slippageBps/10000,spread=.00025,positions=new Map(),pending=new Map(),last=new Map(),usedSignals=new Set(),trades=[],curve=[]
 let cash=capital,halted=false,haltDate=null,peak=capital,maxDrawdown=0,droppedPending=0,ambiguousBars=0
 const value=()=>cash+[...positions.values()].reduce((s,p)=>s+p.qty*(last.get(p.symbol)??p.entry),0)
 const sell=(p,price,b,reason)=>{const fill=price*(1-slip),pnl=p.qty*(fill-p.entry);cash+=p.qty*fill;positions.delete(p.symbol);trades.push({symbol:p.symbol,style,qty:p.qty,entry:p.entry,exit:fill,entryTime:p.entryTime,exitTime:b.t,reason,pnl});}
 for(const session of sessions){
  if(!persistentHalt)halted=false
  const baseline=value(),open=minute(session.open),close=minute(session.close)
  for(let m=open;m<close;m++){
   for(const symbol of [...universe].sort()){
    const day=dataset[symbol].get(session.date),b=day.bars.get(m);if(!b)continue
    last.set(symbol,b.o)
    const p=positions.get(symbol)
    if(p){if(style==='day'&&m>=close-cfg.risk.flattenMinutes)sell(p,b.o,b,'session_close');else if(b.o<=p.stop)sell(p,b.o,b,'stop_gap');else if(b.o>=p.target)sell(p,p.target/(1-slip),b,'target_gap');else if(b.l<=p.stop){if(b.h>=p.target)ambiguousBars++;sell(p,p.stop,b,'stop');}else if(b.h>=p.target)sell(p,p.target/(1-slip),b,'target');}
    if(!halted&&baseline-value()>=capital*cfg.risk.dailyLossPct/100){halted=true;haltDate??=session.date;pending.clear()}
    let order=pending.get(symbol)
    if(order&&(m>=order.expires||halted)){pending.delete(symbol);droppedPending++;order=null}
    if(order&&!positions.has(symbol)&&b.l<=order.limit){const entry=Math.min(order.limit,b.o*(1+spread+slip)),cost=order.qty*entry;if(cost<=cash+1e-8){const held={symbol,qty:order.qty,entry,stop:order.stop,target:order.target,entryTime:b.t};cash-=cost;positions.set(symbol,held);pending.delete(symbol);if(b.l<=held.stop){if(b.h>=held.target)ambiguousBars++;sell(held,Math.min(b.o,held.stop),b,'entry_bar_stop');}else if(b.h>=held.target)sell(held,held.target/(1-slip),b,'entry_bar_target');}}
    last.set(symbol,b.c)
   }
   if(!halted&&baseline-value()>=capital*cfg.risk.dailyLossPct/100){halted=true;haltDate??=session.date;pending.clear()}
   if(halted||style==='day'&&(m+1<open+cfg.day.orbMinutes||m+1>=close-cfg.risk.flattenMinutes-5))continue
   for(const symbol of [...universe].sort()){
    if(positions.has(symbol)||pending.has(symbol)||positions.size+pending.size>=cfg.risk.maxPositions)continue
    const day=dataset[symbol].get(session.date),signal=style==='day'?day.signals.get(m+1):m===open?day.swing:null
    if(!signal)continue
    const id=symbol+':'+signal.bar;if(usedSignals.has(id))continue
    // Swing decisions use completed daily bars and the first observed session quote.
    const reference=style==='day'?signal.price:day.bars.get(open)?.o;if(!reference)continue
    const reserved=[...pending.values()].reduce((s,p)=>s+p.qty*p.limit,0),gross=[...positions.values()].reduce((s,p)=>s+p.qty*(last.get(p.symbol)??p.entry),0)
    const sized=sizeEntry({budget:capital,remaining:Math.max(0,capital-gross-reserved),cash:Math.max(0,cash-reserved),signal,quote:{ap:reference*(1+spread)},risk:cfg.risk})
    if(!sized)continue
    usedSignals.add(id);pending.set(symbol,{qty:sized.qty,limit:sized.price,stop:sized.stop,target:sized.target,expires:m+1+cfg.risk.entryExpiryMinutes})
   }
  }
  // Missing final minute bars use the last observed session price, explicitly counted in exits.
  if(style==='day')for(const p of positions.values())sell(p,last.get(p.symbol),{t:session.date+'T20:00:00Z'},'missing_close_bar_fallback')
  pending.clear();const equity=value();peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);curve.push({date:session.date,equity,cash,positions:positions.size})
 }
 // Liquidate remaining swing holdings at the final observed close for comparable ending values.
 for(const p of [...positions.values()])sell(p,last.get(p.symbol),{t:meta.end+'T20:00:00Z'},'test_end')
 if(curve.length)curve.at(-1).equity=cash
 maxDrawdown=Math.max(maxDrawdown,(peak-cash)/peak*100)
 const wins=trades.filter(t=>t.pnl>0),grossWin=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=-trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0)
 assert.ok(cash>=-1e-7);assert.ok(trades.every(t=>t.qty>=1&&Number.isInteger(t.qty)));assert.ok(Math.abs(capital+trades.reduce((s,t)=>s+t.pnl,0)-cash)<1e-6)
 return {style,universe,capital,endingValue:round(cash),pnl:round(cash-capital),returnPct:round((cash/capital-1)*100),trades:trades.length,winRatePct:trades.length?round(wins.length/trades.length*100):null,profitFactor:grossLoss?round(grossWin/grossLoss):null,maxDailyDrawdownPct:round(maxDrawdown),haltDate,persistentHalt,slippageBps,ambiguousBars,droppedPending,tradeLog:trades,curve}
}
const independent=[]
for(const symbol of symbols)for(const style of ['day','swing'])independent.push(simulate(style,[symbol]))
const portfolios=['day','swing'].flatMap(style=>[simulate(style,symbols),simulate(style,symbols,{persistentHalt:false}),simulate(style,symbols,{slippageBps:10}),simulate(style,symbols,{capital:1000})])
const result={generatedAt:new Date().toISOString(),...meta,coverage,oracleChecks,negativeOracleChecks,independent,portfolios}
mkdirSync('reports/backtest-2026-10-15',{recursive:true})
writeFileSync('reports/backtest-2026-10-15/results.json',JSON.stringify(result,null,2))
const compact=({tradeLog,curve,...r})=>r
console.log(JSON.stringify({coverage,oracleChecks,independent:independent.map(compact),portfolios:portfolios.map(compact)},null,2))
