import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {candidateSignals,sizeOrder,exitFill,simulate,qualification,blockBootstrapInterval,variants} from '../services/strategy-research/model.mjs'
import {dailyFeatures,normalizeCalendar,normalizeSymbol} from '../services/strategy-research/data.mjs'
const protocol=JSON.parse(readFileSync(new URL('../services/strategy-research/protocol.json',import.meta.url),'utf8'))
const parameters={id:'fixture',setup:'breakout',openingMinutes:15,relativeVolume:1,rewardR:2}
function fixture(){
 const day={symbol:'AAPL',features:{previousClose:101,sma20:100,atr:1,gap:.01},openingHistory:{15:1000,30:2000}},market={symbol:'SPY',features:{previousClose:401,sma50:400},openingHistory:{}}
 for(const key of ['o','h','l','c','v','vwap']){day[key]=new Float64Array(100);market[key]=new Float64Array(100)}
 for(let i=0;i<100;i++){day.o[i]=100.05;day.h[i]=100.15;day.l[i]=99.95;day.c[i]=100.1;day.v[i]=100;day.vwap[i]=100.05;market.o[i]=400;market.h[i]=400.3;market.l[i]=399.9;market.c[i]=400.1+i*.001;market.v[i]=100;market.vwap[i]=400.05}
 day.o[15]=100.12;day.h[15]=100.2;day.l[15]=100;day.c[15]=100.18
 return {day,market}
}
test('research grid is finite and protocol forbids leverage and automated promotion',()=>{
 assert.equal(variants(protocol.grid).length,16)
 assert.equal(protocol.status,'research_only')
 assert.ok(protocol.constraints.includes('cash_only'))
 assert.ok(!readFileSync(new URL('../services/strategy-research/model.mjs',import.meta.url),'utf8').includes('paperBroker'))
})
test('candidate uses completed signal bars and ignores later price changes',()=>{
 const {day,market}=fixture(),signals=candidateSignals(day,market,parameters,protocol.risk)
 assert.equal(signals.size,1);const signal=signals.get(16);assert.equal(signal.signalMinute,15);assert.ok(signal.stop<signal.limit);assert.ok(signal.target>signal.limit)
 for(let i=16;i<100;i++){day.c[i]=1;day.h[i]=1000;day.l[i]=.01;market.c[i]=1}
 assert.deepEqual(candidateSignals(day,market,parameters,protocol.risk).get(16),signal)
})
test('candidate rejects missing opening bars, weak market, low activity and excessive risk',()=>{
 for(const change of [({day})=>day.c[0]=NaN,({market})=>market.features.previousClose=300,({day})=>day.openingHistory[15]=10000,({day})=>day.l[14]=90]){
  const f=fixture();change(f);assert.equal(candidateSignals(f.day,f.market,parameters,protocol.risk).size,0)
 }
})
test('sizing cannot borrow, use reserved funds, add fractions or exceed dollar risk',()=>{
 const signal={limit:100,stop:99,target:102}
 const sized=sizeOrder(signal,{cash:2000,equity:2000,capital:2000,risk:protocol.risk})
 assert.equal(sized.qty,5);assert.ok(sized.qty*(signal.limit-signal.stop)<=5)
 assert.equal(sizeOrder(signal,{cash:99,reserved:0,equity:2000,capital:2000,risk:protocol.risk}),null)
 assert.equal(sizeOrder(signal,{cash:200,reserved:150,equity:2000,capital:2000,risk:protocol.risk}),null)
 assert.equal(sizeOrder({...signal,stop:101},{cash:2000,equity:2000,capital:2000,risk:protocol.risk}),null)
})
test('stop gaps and ambiguous bars are adverse; take-profit fills cannot exceed target',()=>{
 const p={qty:2,entry:100,stop:99,target:102,entryMinute:0},costs={slippageBps:5,spreadBps:2.5,sellFeePerShare:.01}
 assert.ok(exitFill(p,{o:97,h:100,l:96},costs,1,390,protocol.risk).price<97)
 assert.equal(exitFill(p,{o:100,h:103,l:98},costs,1,390,protocol.risk).reason,'stop_before_target')
 assert.equal(exitFill(p,{o:103,h:104,l:100},costs,1,390,protocol.risk).price,102)
 assert.equal(exitFill(p,{o:100,h:100,l:100},costs,385,390,protocol.risk).reason,'session_close')
})
test('cash-only simulation reconciles and closes exposure without recycling same-day sales',()=>{
 const {day,market}=fixture();day.o[16]=100.18;day.h[16]=100.2;day.l[16]=100.1;day.c[16]=100.18
 const data={calendar:[{date:'2026-10-01',minutes:100}],series:new Map([['AAPL',new Map([['2026-10-01',day]])],['SPY',new Map([['2026-10-01',market]])]])}
 const p={...protocol,symbols:['AAPL']},result=simulate(data,parameters,p,{start:'2026-10-01',end:'2026-10-01'})
 assert.equal(result.trades,1);assert.equal(result.tradeLog[0].entryMinute,16)
 assert.ok(result.curve[0].unsettled>0)
 assert.ok(Math.abs(result.capital+result.tradeLog.reduce((s,t)=>s+t.pnl,0)-result.curve[0].equity)<1e-7)
 assert.equal(result.diagnostics.missingCloseBars,0)
})
test('calendar observes daylight saving and early closes',()=>{
 const [winter,summer,short]=normalizeCalendar([{date:'2026-01-15',open:'09:30',close:'16:00'},{date:'2026-07-15',open:'09:30',close:'16:00'},{date:'2026-11-27',open:'09:30',close:'13:00'}])
 assert.equal(new Date(winter.utcOpen).toISOString(),'2026-01-15T14:30:00.000Z')
 assert.equal(new Date(summer.utcOpen).toISOString(),'2026-07-15T13:30:00.000Z')
 assert.equal(short.minutes,210)
})
test('daily indicators ignore current and future daily closes',()=>{
 const bars=Array.from({length:80},(_,i)=>({t:new Date(Date.UTC(2026,0,i+1)).toISOString(),c:100+i,o:100+i,h:101+i,l:99+i,v:1000})),date=bars[60].t.slice(0,10),expected=dailyFeatures(bars,date)
 for(let i=60;i<80;i++)bars[i].c=100000
 assert.deepEqual(dailyFeatures(bars,date),expected)
})
test('data loader rejects duplicate timestamps and counts invalid bars',()=>{
 const calendar=normalizeCalendar([{date:'2026-10-01',open:'09:30',close:'16:00'}]),bar={t:'2026-10-01T13:30:00Z',o:100,h:101,l:99,c:100,v:10}
 assert.throws(()=>normalizeSymbol('TEST',[bar,bar],[],calendar),/duplicate/)
 assert.equal(normalizeSymbol('TEST',[{...bar,l:102}],[],calendar).coverage.invalidBars,1)
})
test('positive return alone cannot pass a statistically empty candidate',()=>{
 const result={trades:1,pnl:10,profitFactor:10,maximumDailyDrawdownPct:0,activeMonths:1,positiveActiveMonthFraction:1,diagnostics:{missingCloseBars:0}}
 assert.equal(qualification(result,'test',protocol).passed,false)
 assert.ok(qualification(result,'test',protocol).reasons.includes('insufficient trades'))
 const interval=blockBootstrapInterval(Array(100).fill(-.001))
 assert.ok(interval.upperDailyMean<0)
 assert.deepEqual(interval,blockBootstrapInterval(Array(100).fill(-.001)))
})
