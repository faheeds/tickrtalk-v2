import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseDirectory,commonStockUniverse,priorEligibility,shortlist,activationAssessment} from '../services/strategy-research/universe-scanner.mjs'
import {historicalFeatures,sessionBars,signalsForSession,assignArms} from '../services/strategy-research/broad-signals.mjs'
import {simulateBroad,exitBroadFill} from '../services/strategy-research/broad-simulation.mjs'
import {signalFingerprint,executionFingerprint} from '../services/strategy-research/broad-data-hashes.mjs'
import {newsEvidence} from '../services/strategy-research/catalysts.mjs'
import {sessionPriceFactor,nominalSession,nominalFeatures} from '../services/strategy-research/nominal-prices.mjs'
import {sizeOrder} from '../services/strategy-research/model.mjs'
const p=JSON.parse(readFileSync(new URL('../services/strategy-research/broad-protocol.json',import.meta.url),'utf8'))
test('common-stock universe rejects ETFs, test issues, inactive and unsupported instruments without excluding ordinary trust-company stock',()=>{
 const directory=parseDirectory('Symbol|Security Name|Listing Exchange|ETF|Test Issue\nNTRS|Northern Trust Corporation Common Stock|Q|N|N\nETF|Example Fund Common Stock|Q|Y|N\nPRF|Preferred Common Stock|N|N|N\nTEST|Example Common Stock|Q|N|Y\nOFF|Example Common Stock|Q|N|N\nFile Creation Time: x'),assets=directory.map(r=>({symbol:r.Symbol,class:'us_equity',status:r.Symbol==='OFF'?'inactive':'active',tradable:true,exchange:'NASDAQ'}))
 assert.deepEqual(commonStockUniverse(directory,assets).map(s=>s.symbol),['NTRS'])
 assert.throws(()=>parseDirectory('Symbol|Unknown\nA|B'),/schema/)
})
test('liquidity eligibility uses prior sessions only and refuses young or stale histories',()=>{
 const bars=Array.from({length:80},(_,i)=>({t:new Date(Date.UTC(2026,0,i+1)).toISOString(),o:20,h:21,l:19,c:20,v:3000000})),date=bars[65].t.slice(0,10),before=priorEligibility(bars,date,p.eligibility)
 assert.equal(before.eligible,true);for(let i=65;i<80;i++){bars[i].c=.01;bars[i].v=0}
 assert.deepEqual(priorEligibility(bars,date,p.eligibility),before)
 assert.equal(priorEligibility(bars.slice(0,20),date,p.eligibility).eligible,false)
 assert.equal(priorEligibility(bars,'2026-06-01',p.eligibility).eligible,false)
})
test('daily scanner ranks only eligible opportunities, respects its cap and does not treat missing volume as evidence',()=>{
 const rows=Array.from({length:25},(_,i)=>({symbol:'S'+i,eligible:true,relativeVolume:2+i,gapPct:1}));rows.push({symbol:'UNKNOWN',eligible:true,relativeVolume:null,gapPct:1},{symbol:'LOW',eligible:false,relativeVolume:100,gapPct:2})
 const selected=shortlist(rows,p.scanner);assert.equal(selected.length,20);assert.equal(selected[0].symbol,'S24');assert.ok(!selected.some(s=>['LOW','UNKNOWN'].includes(s.symbol)))
})
test('execution preflight fails closed on screening, catalysts, quotes, cash and readiness; even a pass grants no order authority',()=>{
 const now='2026-10-16T14:00:00Z',input={now,quote:{bp:100,ap:100.02,t:now},screening:{status:'halal',fullyVerified:true,assessedAt:now},catalyst:{verified:true,publishedAt:now},availableCash:2000,orderNotional:100,realtimeFeedVerified:true,universeAuditVerified:true,prospectiveValidationVerified:true}
 assert.equal(activationAssessment(input).eligible,true);assert.equal(activationAssessment(input).executionEnabled,false)
 assert.equal(activationAssessment({...input,screening:{status:'doubtful',fullyVerified:true,assessedAt:now}}).eligible,false)
 assert.equal(activationAssessment({...input,quote:{bp:100,ap:101,t:now}}).eligible,false)
 assert.equal(activationAssessment({...input,quote:{bp:9,ap:9.001,t:now}}).eligible,false)
 assert.equal(activationAssessment({...input,catalyst:{verified:true,publishedAt:'2026-10-17T14:00:00Z'}}).eligible,false)
 assert.equal(activationAssessment({...input,catalyst:{verified:true,publishedAt:'2026-09-01T14:00:00Z'}}).eligible,false)
 assert.equal(activationAssessment({...input,availableCash:50}).eligible,false)
 assert.equal(activationAssessment({...input,realtimeFeedVerified:false}).eligible,false)
})
function signalFixture(){
 const orb={minute:0,o:100,h:100.3,l:99.9,c:100.2,v:2000,vwap:100.1},bar={minute:15,o:100.2,h:100.5,l:100.1,c:100.4,v:2000,vwap:100.2},day={opening:orb,relativeVolume:2,bars:[orb,bar]},market={opening:{o:400},bars:[{minute:0,c:400.1,vwap:400},{minute:15,c:400.2,vwap:400.1}]}
 return {symbol:'AAA',day,market,features:{previousClose:100,sma20:99,atr:1},marketFeatures:{previousClose:401,sma50:400},protocol:p}
}
test('coarse signals become available only after bar completion; later prices cannot alter an earlier decision',()=>{
 const f=signalFixture(),signals=signalsForSession(f);assert.equal(signals.length,1);assert.equal(signals[0].setup,'morning_breakout');assert.equal(signals[0].minute,30);assert.equal(signals[0].signalMinute,29)
 f.day.bars.push({minute:30,o:1,h:2,l:.1,c:1,vwap:1,v:1});assert.deepEqual(signalsForSession(f)[0],signals[0])
})
test('VWAP reclaim is a separate selloff-reversal hypothesis',()=>{
 const f=signalFixture();f.day.opening={minute:0,o:100,h:100.1,l:99.5,c:99.6,v:2000,vwap:99.7};f.day.bars=[f.day.opening,{minute:15,o:99.6,h:100.3,l:99.6,c:100.2,v:2000,vwap:99.9}]
 const signals=signalsForSession(f);assert.equal(signals.length,1);assert.equal(signals[0].setup,'vwap_reclaim')
})
test('universe arms use the fixed morning shortlist and preserve identical signal prices',()=>{
 const records=[{date:'2026-10-01',symbol:'AAA',eligible:true,relativeVolume:2,gapPct:1},{date:'2026-10-01',symbol:'BBB',eligible:true,relativeVolume:1,gapPct:0}],signals=[{date:'2026-10-01',symbol:'AAA',sp500:true,limit:100},{date:'2026-10-01',symbol:'BBB',sp500:false,limit:100}],result=assignArms(records,signals,p)
 assert.deepEqual(result.signals[0].arms,['sp500','broad_liquid','daily_opportunities']);assert.deepEqual(result.signals[1].arms,['broad_liquid']);assert.equal(result.signals[0].limit,100)
})
test('broad replay cannot fill before a completed signal or spend unavailable cash and uses one-minute exit bars',()=>{
 const utcOpen=Date.parse('2026-10-01T13:30:00Z'),rows=Array.from({length:100},(_,i)=>({t:new Date(utcOpen+i*60000).toISOString(),o:100,h:100.1,l:99.9,c:100,v:100})),signal={symbol:'AAA',date:'2026-10-01',setup:'morning_breakout',arms:['sp500'],minute:30,signalMinute:29,limit:100.1,stop:99,target:102.3,score:1},data={sessions:[{date:signal.date,minutes:100,utcOpen}],signals:[signal],readSession:()=>({AAA:rows})},result=simulateBroad(data,{arm:'sp500',setup:'morning_breakout'},p,{start:signal.date,end:signal.date})
 assert.equal(result.trades,1);assert.equal(result.tradeLog[0].entryMinute,30);assert.ok(result.curve[0].cash>=0);assert.ok(result.curve[0].unsettled>0);assert.ok(Math.abs(result.capital+result.tradeLog[0].pnl-result.curve[0].equity)<1e-6)
 assert.throws(()=>simulateBroad({...data,readSession:()=>({})},{arm:'sp500',setup:'morning_breakout'},p,{start:signal.date,end:signal.date}),/missing/)
})
test('resting protection crossed at a bar open precedes later intrabar ambiguity or a time exit',()=>{
 const position={qty:2,entry:100,stop:99,target:102,entryMinute:0},costs={slippageBps:5,spreadBps:2.5,sellFeePerShare:.01}
 const target=exitBroadFill(position,{o:103,h:104,l:98,c:100},costs,95,390,p.risk)
 assert.equal(target.reason,'target_gap');assert.equal(target.price,102)
 const stop=exitBroadFill(position,{o:98,h:104,l:97,c:100},costs,95,390,p.risk)
 assert.equal(stop.reason,'stop_gap');assert.ok(stop.price<98)
})
test('prior trend features ignore future closes and session VWAP excludes premarket bars',()=>{
 const daily=Array.from({length:80},(_,i)=>({t:new Date(Date.UTC(2026,0,i+1)).toISOString(),o:100,h:101,l:99,c:100,v:1000})),date=daily[65].t.slice(0,10),before=historicalFeatures(daily,date);daily[70].c=100000;assert.deepEqual(historicalFeatures(daily,date),before)
 const utcOpen=Date.parse('2026-10-01T13:30:00Z'),rows=[{t:new Date(utcOpen-900000).toISOString(),o:1000,h:1000,l:1000,c:1000,v:1e9},{t:new Date(utcOpen).toISOString(),o:100,h:101,l:99,c:100,v:100}]
 const regular=sessionBars(rows,{utcOpen,minutes:390});assert.equal(regular.length,1);assert.equal(regular[0].vwap,100)
 assert.throws(()=>sessionBars([rows[1],rows[1]],{utcOpen,minutes:390}),/Duplicate/)
})
test('semantic data fingerprints ignore retrieval timestamps but detect changed signals and price files',()=>{
 const index={protocolHash:'a',signals:[{limit:100}],shortlists:{},sessions:[],stockCount:10,eligibleCount:5,sp500EligibleCount:3,builtAt:'old'}
 assert.equal(signalFingerprint(index),signalFingerprint({...index,builtAt:'new'}))
 assert.notEqual(signalFingerprint(index),signalFingerprint({...index,signals:[{limit:101}]}))
 const manifest={feed:'sip',adjustment:'split',files:[{file:'test',sha256:'a'}],fetchedAt:'old'}
 assert.equal(executionFingerprint(manifest),executionFingerprint({...manifest,fetchedAt:'new'}))
 assert.notEqual(executionFingerprint(manifest),executionFingerprint({...manifest,files:[{file:'test',sha256:'b'}]}))
})
test('news evidence excludes future publications and later edits, matches the symbol and never creates a verified catalyst',()=>{
 const good={id:1,symbols:['AAA'],created_at:'2026-10-15T12:00:00Z',updated_at:'2026-10-15T12:01:00Z',headline:'Company reports earnings',url:'https://example.com/news',source:'fixture'},asOf='2026-10-15T13:45:00Z'
 const result=newsEvidence([good,{...good,id:2,updated_at:'2026-10-15T14:00:00Z'},{...good,id:3,created_at:'2026-10-15T14:00:00Z'},{...good,id:4,symbols:['BBB']}],'AAA',asOf)
 assert.equal(result.length,1);assert.equal(result[0].verified,false);assert.equal(result[0].status,'evidence_requires_review')
 assert.throws(()=>newsEvidence([],'AAA','invalid'),/decision time/)
})
test('nominal historical prices preserve true whole-share affordability across later splits',()=>{
 const adjusted={t:'2024-10-15T04:00:00Z',o:300,h:302,l:299,c:301,v:10000},raw={t:adjusted.t,o:3000,h:3020,l:2990,c:3010,v:1000},factor=sessionPriceFactor(adjusted,raw)
 assert.equal(factor,10)
 const day=nominalSession({opening:adjusted,bars:[adjusted],relativeVolume:2},factor);assert.equal(day.opening.o,3000);assert.equal(day.relativeVolume,2)
 const context={cash:2000,equity:2000,capital:2000,risk:p.risk}
 assert.ok(sizeOrder({limit:300,stop:299,target:302},context))
 assert.equal(sizeOrder({limit:3000,stop:2990,target:3020},context),null)
 assert.deepEqual(nominalFeatures({sma20:300,atr:1},10),{sma20:3000,atr:10})
 assert.throws(()=>sessionPriceFactor(adjusted,{...raw,c:4000}),/consistent/)
 assert.throws(()=>nominalSession(day,NaN),/positive/)
 assert.equal(sessionPriceFactor({o:77.88,h:78.87,l:76.78,c:76.86,v:8335024},{o:311.5,h:315.476,l:307.135,c:307.45,v:2083756}),4)
 assert.equal(sessionPriceFactor({o:9058.75,h:9790,l:4525.01,c:6512.5,v:118116},{o:72.47,h:78.32,l:36.2001,c:52.1,v:14764622}),.008)
})
