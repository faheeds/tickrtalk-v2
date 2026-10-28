import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {once} from 'node:events'
import {PaperStore} from '../services/paper/store.mjs'
import {PaperEngine,managedPnl} from '../services/paper/engine.mjs'
import {BrokerError,paperBroker,PAPER_URL} from '../services/paper/broker.mjs'
import {DEFAULT_DRAFT,clientId,completedBars,eastern,entryBody,evaluate,freshQuote,session,sizeEntry,strictHalal,validateDraft} from '../services/paper/core.mjs'
import {createPaperService} from '../services/paper/server.mjs'
import {calcRSI,calcSuperTrend} from '../lib/strategies/indicators.ts'
import {parseConstituents,sp500Snapshot,resolveUniverse} from '../services/paper/universe.mjs'

const fixed=new Date('2026-10-13T14:02:10Z'),key='a'.repeat(64)
const clock={is_open:true,timestamp:fixed.toISOString(),next_open:'2026-10-14T13:30:00Z'}
const calendar=[{date:'2026-10-13',open:'09:30',close:'16:00'}]
function bars(){return Array.from({length:32},(_,i)=>({t:new Date(Date.parse('2026-10-13T13:30:00Z')+i*60000).toISOString(),o:100,h:i===31?103:101,l:99,c:i===31?102:100,v:i===31?300:100,vw:100}))}
function fixture(){
  const folder=mkdtempSync(join(tmpdir(),'tickrtalk-paper-')),store=new PaperStore(folder,key),orders=new Map(),submissions=[]
  const broker={account:async()=>({id:'paper-account-test',status:'ACTIVE',cash:'10000',non_marginable_buying_power:'10000',multiplier:'1',short_market_value:'0',buying_power:'10000',equity:'10000'}),positions:async()=>[],orders:async()=>[...orders.values()].filter(o=>!['filled','canceled'].includes(o.status)),clock:async()=>clock,calendar:async()=>calendar,
    asset:async()=>({tradable:true,status:'active',class:'us_equity'}),bars:async()=>bars(),quote:async()=>({quote:{bp:102,ap:102.1,t:fixed.toISOString()}}),
    order:async id=>{const result=orders.get(id);if(!result)throw new BrokerError('Missing',404);return structuredClone(result)},byClient:async id=>{const result=[...orders.values()].find(o=>o.client_order_id===id);if(!result)throw new BrokerError('Missing',404);return structuredClone(result)},
    submit:async body=>{submissions.push(body);const result={...body,id:'broker-'+body.client_order_id,status:'new',filled_qty:'0',filled_avg_price:null,created_at:fixed.toISOString(),legs:[]};orders.set(result.id,result);return structuredClone(result)},cancel:async id=>{orders.get(id).status='canceled'},}
  const engine=new PaperEngine(store,{brokerFactory:()=>broker,now:()=>fixed})
  store.connect('alice','paper-account-test',{key:'fixture-key',secret:'fixture-secret'})
  store.publish(validateDraft(DEFAULT_DRAFT),'owner');store.authorize('alice','day',1000);store.db.prepare('UPDATE allocations SET started=?').run(fixed.toISOString())
  return {folder,store,broker,engine,submissions,orders,close(){engine.close();store.close();rmSync(folder,{recursive:true,force:true})}}
}

test('paper broker cannot use a live trading endpoint and handles empty cancel responses',async()=>{
  const calls=[],broker=paperBroker({key:'fixture',secret:'fixture'},async(url,options)=>{calls.push([url,options]);return new Response(null,{status:204})})
  await broker.cancel('order');await broker.submit({symbol:'AAPL'})
  assert.ok(calls.every(([url])=>url.startsWith(PAPER_URL+'/')))
  assert.equal(calls[1][1].headers['APCA-API-KEY-ID'],'fixture')
})
test('strategy drafts reject malformed limits and impossible moving-average ranges',()=>{
  assert.throws(()=>validateDraft({...DEFAULT_DRAFT,risk:{...DEFAULT_DRAFT.risk,maxOrder:2000}}))
  assert.throws(()=>validateDraft({...DEFAULT_DRAFT,longterm:{...DEFAULT_DRAFT.longterm,fastSma:100,slowSma:100}}))
  assert.throws(()=>validateDraft({...DEFAULT_DRAFT,universe:['AAPL','../secret']}))
  assert.equal(validateDraft(DEFAULT_DRAFT).risk.maxBudget,1000)
})
test('Eastern market timing follows daylight saving and Alpaca early-close calendars',()=>{
  assert.equal(eastern('2026-01-15T15:00:00Z').minutes,600)
  assert.equal(eastern('2026-07-15T14:00:00Z').minutes,600)
  const market=session({is_open:true,timestamp:'2026-11-27T17:56:00Z'},[{date:'2026-11-27',open:'09:30',close:'13:00'}])
  assert.equal(market.closeMinute,780);assert.equal(market.minutes,776)
})
test('opening range excludes premarket and incomplete or future bars',()=>{
  const raw=[{...bars()[0],t:'2026-10-13T12:30:00Z'},...bars(),{...bars()[0],t:'2026-10-13T14:02:00Z'},{...bars()[0],t:'2026-10-13T14:10:00Z'}]
  const complete=completedBars(raw,fixed,true)
  assert.equal(complete.length,32)
  assert.equal(evaluate('day',complete,DEFAULT_DRAFT.day,session(clock,calendar)).side,'buy')
  assert.equal(evaluate('day',complete.filter((_,i)=>i!==4),DEFAULT_DRAFT.day,session(clock,calendar)),null)
})
test('RSI includes every delta in its seed and SuperTrend switches bands on a reversal',()=>{
  assert.equal(calcRSI([100,101,102,103,104,105,106,107,108,109,110,111,112,113,100],14)[14],50)
  const values=[100,100,100,100,100,115,120,120,95,90].map((c,i)=>({date:new Date(i),open:c,high:c+1,low:c-1,close:c,volume:10,vwap:null}))
  const trend=calcSuperTrend(values,3,1)
  assert.equal(trend.direction[6],1);assert.equal(trend.direction[9],-1)
  assert.ok(trend.supertrend[9]>values[9].close)
})
test('fresh quotes use broker timestamps and reject stale, crossed, or wide markets',()=>{
  const risk=DEFAULT_DRAFT.risk
  assert.throws(()=>freshQuote({bp:100,ap:101,t:'2026-10-13T13:00:00Z'},fixed,risk))
  assert.throws(()=>freshQuote({bp:101,ap:100,t:fixed.toISOString()},fixed,risk))
  assert.throws(()=>freshQuote({bp:100,ap:110,t:fixed.toISOString()},fixed,risk))
  assert.equal(freshQuote({bp:100,ap:100.1,t:fixed.toISOString()},fixed,risk).ap,100.1)
})
test('risk sizing never rounds zero capacity up to a share and retains stop-only protection',()=>{
  const input={budget:1000,remaining:1000,cash:0,signal:{stop:98,target:105},quote:{ap:100},risk:DEFAULT_DRAFT.risk}
  assert.equal(sizeEntry(input),null)
  const size=sizeEntry({...input,cash:1000})
  assert.ok(size.qty*size.price<=500)
  assert.ok(size.qty*(size.price-size.stop)<=5)
  assert.equal(entryBody('AAPL',{...size,target:0},'longterm','id').order_class,'oto')
  assert.ok(entryBody('AAPL',size,'day','id').stop_loss)
  assert.throws(()=>entryBody('AAPL',{...size,qty:0},'day','id'))
})
test('screening fails closed on unknown income, activity, or stale evidence',()=>{
  const full={verdict:{cls:'pass',activityStatus:'pass'},generatedAt:new Date().toISOString(),ratios:[{status:'pass'},{status:'pass'},{status:'pass'}]}
  assert.equal(strictHalal(full),true)
  assert.equal(strictHalal({...full,ratios:[{status:'pass'},{status:'pass'},{status:'review'}]}),false)
  assert.equal(strictHalal({...full,verdict:{cls:'pass'}}),false)
  assert.equal(strictHalal({...full,generatedAt:'2020-01-01'}),false)
})
test('persistent reservation and decision-cycle IDs prevent duplicate and over-budget entries',async()=>{
  const f=fixture()
  try{
    await f.engine.tick();assert.equal(f.submissions.length,2)
    assert.ok(f.submissions.reduce((sum,b)=>sum+Number(b.qty)*Number(b.limit_price),0)<=1000)
    const ids=f.submissions.map(b=>b.client_order_id);assert.equal(new Set(ids).size,2)
    await f.engine.tick();assert.equal(f.submissions.length,2)
    f.engine.lastScan.clear();await f.engine.tick();assert.equal(f.submissions.length,2)
    assert.equal(f.store.fills('alice').length,0,'acknowledged orders are not executions')
  }finally{f.close()}
})
test('uncertain submissions retain their reservation, pause entries, and never blind-retry',async()=>{
  const f=fixture()
  try{
    f.broker.submit=async body=>{f.submissions.push(body);throw new Error('Network response lost')}
    await f.engine.tick();assert.equal(f.store.account('alice').active,false)
    assert.equal(f.store.intents('alice')[0].status,'unknown')
    await f.engine.tick();assert.equal(f.submissions.length,1)
  }finally{f.close()}
})
test('paused or changed authorization cannot submit an already evaluated entry',async()=>{
  const f=fixture()
  try{
    const old=f.store.account('alice');f.store.pause('alice')
    const body=entryBody('AAPL',{qty:1,price:100,stop:98,target:105},'day','test')
    await f.engine.submit(old,{id:'test',symbol:'AAPL',style:'day',version:f.store.release().id,kind:'entry',body,reason:'fixture'},f.broker)
    assert.equal(f.submissions.length,0)
  }finally{f.close()}
})
test('broker-confirmed partial fills deduplicate and retain cumulative price math',()=>{
  const f=fixture()
  try{
    f.store.prepare({id:'fill-intent',user:'alice',symbol:'AAPL',style:'day',version:'v1',kind:'entry',body:{qty:'1'},reason:'fixture'})
    const order={id:'fill-order',symbol:'AAPL',side:'buy',status:'partially_filled',filled_qty:'0.5',filled_avg_price:'100',updated_at:fixed.toISOString(),legs:[]}
    f.store.recordOrder('fill-intent',order);f.store.recordOrder('fill-intent',order)
    f.store.recordOrder('fill-intent',{...order,status:'filled',filled_qty:'1',filled_avg_price:'101'})
    assert.equal(f.store.fills('alice').length,2)
    assert.equal(f.store.fills('alice').reduce((sum,fill)=>sum+fill.qty*fill.price,0),101)
    assert.equal(f.store.owned('alice')[0].qty,1)
    assert.deepEqual(managedPnl(f.store.fills('alice',null),[{symbol:'AAPL',current_price:'103'}]),{realized:0,unrealized:2,total:2})
  }finally{f.close()}
})
test('managed exit cannot sell more shares than the broker actually holds',async()=>{
  const f=fixture()
  try{
    const order={id:'held-order',symbol:'AAPL',side:'buy',status:'filled',filled_qty:'1',filled_avg_price:'100',legs:[]}
    f.store.prepare({id:'held',user:'alice',symbol:'AAPL',style:'day',version:'v1',kind:'entry',body:{qty:'1'},reason:'fixture'});f.store.recordOrder('held',order)
    f.broker.positions=async()=>[{symbol:'AAPL',qty:'0.4',current_price:'103'}]
    await f.engine.exit(f.store.account('alice'),f.broker,f.store.owned('alice')[0],'fixture',session(clock,calendar))
    assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].qty,'0.400000');assert.equal(f.submissions[0].side,'sell')
    await f.engine.exit(f.store.account('alice'),f.broker,f.store.owned('alice')[0],'fixture',session(clock,calendar))
    assert.equal(f.submissions.length,1,'an open exit cannot produce another exit')
  }finally{f.close()}
})
test('manual positions are not adopted by the engine and closed-market checks place nothing',async()=>{
  const f=fixture()
  try{
    f.broker.positions=async()=>[{symbol:'AAPL',qty:'1',current_price:'103'}]
    assert.equal(f.store.owned('alice').length,0)
    f.broker.clock=async()=>({...clock,is_open:false});await f.engine.tick()
    assert.equal(f.submissions.length,0)
  }finally{f.close()}
})
test('credential storage is encrypted and account ownership is unique',()=>{
  const f=fixture()
  try{
    assert.ok(!f.store.account('alice').credentials.includes('fixture-secret'))
    assert.equal(f.store.decrypt(f.store.account('alice').credentials).secret,'fixture-secret')
    assert.throws(()=>f.store.connect('bob','paper-account-test',{key:'other',secret:'other'}))
    assert.ok(!readFileSync(join(f.folder,'paper.sqlite')).includes(Buffer.from('fixture-secret')))
  }finally{f.close()}
})
test('service roles restrict owner configuration and do not expose customer credentials',async()=>{
  const f=fixture(),token='private-test-token-'.repeat(3),{server}=createPaperService({store:f.store,engine:f.engine,token})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const url=`http://127.0.0.1:${server.address().port}/api`
  try{
    const headers={Authorization:'Bearer '+token,'X-Paper-User':'alice','X-Paper-Role':'customer','Content-Type':'application/json'}
    const blocked=await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'publish',owner:true,paperOnly:true})})
    assert.equal(blocked.status,403)
    const data=await(await fetch(url,{headers})).json()
    assert.equal(data.draft,undefined);assert.equal(data.audit,undefined);assert.ok(!JSON.stringify(data).includes('fixture-secret'))
    const bob=await(await fetch(url,{headers:{...headers,'X-Paper-User':'bob'}})).json();assert.equal(bob.account,null);assert.equal(bob.fills.length,0)
    assert.equal((await fetch(url)).status,401)
  }finally{await new Promise(resolve=>server.close(resolve));f.close()}
})

test('parent stream updates preserve protective leg ownership and fills',()=>{
  const f=fixture()
  try{
    f.store.prepare({id:'protected',user:'alice',symbol:'AAPL',style:'day',version:'v1',kind:'entry',body:{qty:'1'},reason:'fixture'})
    const order={id:'parent',symbol:'AAPL',side:'buy',status:'filled',filled_qty:'1',filled_avg_price:'100',legs:[{id:'stop',symbol:'AAPL',side:'sell',status:'filled',filled_qty:'1',filled_avg_price:'99'}]}
    f.store.recordOrder('protected',order)
    const {legs,...stream}=order
    f.store.recordOrder('protected',stream)
    assert.equal(f.store.owned('alice').length,0)
    assert.equal(f.store.fills('alice').length,2)
  }finally{f.close()}
})
test('an open clock without a matching calendar fails closed',()=>{
  assert.throws(()=>session(clock,[]),/calendar/)
})

test('early-close day monitoring closes only managed exposure even when entries are paused',async()=>{
  const f=fixture()
  try{
    const early=new Date('2026-11-27T17:56:00Z')
    f.engine.now=()=>early
    f.broker.clock=async()=>({is_open:true,timestamp:early.toISOString()})
    f.broker.calendar=async()=>[{date:'2026-11-27',open:'09:30',close:'13:00'}]
    f.broker.positions=async()=>[{symbol:'AAPL',qty:'1',current_price:'100'},{symbol:'MANUAL',qty:'10',current_price:'100'}]
    const parent={id:'held-parent',symbol:'AAPL',side:'buy',status:'filled',filled_qty:'1',filled_avg_price:'100',legs:[]}
    f.store.prepare({id:'early-position',user:'alice',symbol:'AAPL',style:'day',version:f.store.release().id,kind:'entry',body:{qty:'1'},reason:'fixture'});f.store.recordOrder('early-position',parent)
    f.store.pause('alice')
    await f.engine.tick()
    assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].symbol,'AAPL');assert.equal(f.submissions[0].side,'sell')
  }finally{f.close()}
})
test('session loss guard prevents new entries and pauses authorization',async()=>{
  const f=fixture()
  try{
    f.store.baseline('alice','2026-10-13',0)
    const context=await f.engine.refresh(f.store.account('alice'))
    context.snapshot.pnl={realized:-21,unrealized:0,total:-21}
    const result=await f.engine.scan(f.store.account('alice'),context,f.store.release())
    assert.equal(result.reason,'Daily loss guard reached.');assert.equal(f.submissions.length,0);assert.equal(f.store.account('alice').active,false)
  }finally{f.close()}
})

test('out-of-order fill updates cannot erase tracked exposure',()=>{
 const f=fixture()
 try{
  f.store.prepare({id:'monotonic',user:'alice',symbol:'AAPL',style:'day',version:'v1',kind:'entry',body:{qty:'1'},reason:'fixture'})
  const order={id:'cumulative',symbol:'AAPL',side:'buy',status:'filled',filled_qty:'1',filled_avg_price:'100'}
  f.store.recordOrder('monotonic',order)
  assert.throws(()=>f.store.recordOrder('monotonic',{...order,status:'new',filled_qty:'0',filled_avg_price:null}),/decreased/)
  assert.equal(f.store.owned('alice')[0].qty,1)
 }finally{f.close()}
})

test('S&P 500 selection uses a sourced full snapshot and rejects partial constituent files',()=>{
 const snapshot=sp500Snapshot(),draft=validateDraft(resolveUniverse({...DEFAULT_DRAFT,universeMode:'sp500',universe:['AAPL']}))
 assert.ok(snapshot.members.length>=450);assert.equal(draft.universe.length,snapshot.members.length)
 assert.equal(draft.universeMode,'sp500');assert.equal(draft.universeAsOf,snapshot.retrievedAt)
 assert.throws(()=>parseConstituents('Symbol,Security,GICS Sector\nAAPL,Apple,Technology\n'),/incomplete/)
 assert.throws(()=>validateDraft({...draft,universe:Array.from({length:601},()=> 'AAPL')}),/600/)
})
test('batch bars fetch all pagination and symbol groups without per-stock data requests',async()=>{
 const symbols=Array.from({length:103},(_,i)=>'TEST'+i),calls=[]
 const broker=paperBroker({key:'fixture',secret:'fixture'},async raw=>{
  const url=new URL(raw);calls.push(url)
  assert.equal(url.pathname,'/v2/stocks/bars')
  const group=url.searchParams.get('symbols').split(','),page=url.searchParams.get('page_token')
  return Response.json({bars:page?Object.fromEntries(group.slice(1).map(s=>[s,[bars()[1]]])):{[group[0]]:[bars()[0]]},next_page_token:page?null:'second-page'})
 })
 const result=await broker.barsMany(symbols,true,clock)
 assert.equal(Object.keys(result).length,103);assert.ok(symbols.every(s=>result[s].length===1))
 assert.equal(calls.length,6);assert.ok(calls.every(u=>u.searchParams.get('symbols').split(',').length<=50))
})
test('incomplete batch pagination fails closed rather than silently dropping later stocks',async()=>{
 const broker=paperBroker({key:'fixture',secret:'fixture'},async()=>Response.json({bars:{AAPL:bars()},next_page_token:'repeated'}))
 await assert.rejects(broker.barsMany(['AAPL'],true,clock),/repeated/)
})
test('scanner reaches the final S&P 500 constituent and still enforces capital limits',async()=>{
 const f=fixture()
 try{
  const draft=validateDraft(resolveUniverse({...DEFAULT_DRAFT,universeMode:'sp500'})),last=draft.universe.at(-1)
  f.store.publish(draft,'owner');let requested=[]
  f.broker.assets=async()=>draft.universe.map(symbol=>({symbol,tradable:true,status:'active',class:'us_equity'}))
  f.broker.barsMany=async symbols=>{requested=symbols;return Object.fromEntries(symbols.map(s=>[s,s===last?bars():[]]))}
  f.broker.bars=async()=>{throw new Error('Per-stock history must not be used for the universe scan.')}
  const context=await f.engine.refresh(f.store.account('alice')),result=await f.engine.scan(f.store.account('alice'),context,f.store.release())
  assert.equal(requested.length,draft.universe.length);assert.equal(result.scanned,draft.universe.length)
  assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].symbol,last)
  assert.ok(Number(f.submissions[0].qty)*Number(f.submissions[0].limit_price)<=500)
 }finally{f.close()}
})
test('full universe validation remains publishable without truncating the saved validation audit',async()=>{
 const f=fixture(),{dispatch}=createPaperService({store:f.store,engine:f.engine,token:'fixture'.repeat(10)})
 try{
  await assert.rejects(dispatch('alice',false,'refresh_sp500',{}),/Owner/)
  const saved=await dispatch('alice',true,'save_draft',{draft:{...DEFAULT_DRAFT,universeMode:'sp500',universe:['AAPL']}})
  f.broker.assets=async()=>saved.draft.universe.map(symbol=>({symbol,tradable:true,status:'active',class:'us_equity'}))
  const validated=await dispatch('alice',true,'validate_draft',{})
  assert.equal(validated.validation.assets.length,saved.draft.universe.length)
  const published=await dispatch('alice',true,'publish',{paperOnly:true})
  assert.ok(published.version);assert.equal(f.store.release().body.universe.length,saved.draft.universe.length)
  assert.doesNotThrow(()=>JSON.parse(f.store.audit('alice',true).find(a=>a.action==='draft_validated').detail))
 }finally{f.close()}
})

test('cash preflight rejects derivatives, borrowing, malformed reservations and overselling',async()=>{
 for(const scenario of ['derivative','margin','reservation','oversell']){
  const f=fixture();try{
   const account=f.store.account('alice'),id='guard-'+scenario,version=f.store.release().id;
   if(scenario==='derivative')f.broker.asset=async()=>({class:'us_option',tradable:true,status:'active'});
   if(scenario==='margin'){const original=f.broker.account;f.broker.account=async()=>({...await original(),multiplier:'2'})}
   if(scenario==='reservation')f.broker.orders=async()=>[{side:'buy',qty:'invalid',limit_price:'100'}];
   const body={symbol:'AAPL',qty:'1',side:scenario==='oversell'?'sell':'buy',type:scenario==='oversell'?'market':'limit',limit_price:'100',client_order_id:id};
   assert.equal(await f.engine.submit(account,{id,symbol:'AAPL',style:'day',version,kind:scenario==='oversell'?'exit':'entry',body,reason:'test guard'},f.broker),false);assert.equal(f.submissions.length,0);assert.equal(f.store.intent(id).status,'rejected');
  }finally{f.close()}
 }
})
test('pause and resume preserve original allocation and isolate manual holdings',()=>{
 const f=fixture();try{
  const original=f.store.ensureAllocation(f.store.account('alice'));f.store.pause('alice');f.store.authorize('alice','day',1000);const current=f.store.ensureAllocation(f.store.account('alice'));assert.equal(current.id,original.id);assert.equal(current.started,original.started);
  f.store.snapshot('alice',{observedAt:fixed.toISOString(),positions:[{symbol:'MANUAL',qty:'10',current_price:'900'}]});const performance=f.store.performance('alice',fixed.toISOString()).day;assert.equal(performance.capital,1000);assert.equal(performance.value,1000);assert.equal(performance.realized,0);
 }finally{f.close()}
})

test('a filled sale permits immediate re-entry only when broker cash covers the order',async()=>{
 for(const scenario of ['available','broker-unavailable','sale-unfilled']){
 const f=fixture();try{
  f.store.db.prepare('UPDATE allocations SET started=?').run('2026-10-13T13:00:00Z');
  const insert=f.store.db.prepare('INSERT INTO fills VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('cash-buy','alice','TEST','day','test','buy',9,100,'2026-10-13T13:40:00Z','cash-buy','test');
  if(scenario!=='sale-unfilled')insert.run('cash-sell','alice','TEST','day','test','sell',9,101,'2026-10-13T14:00:00Z','cash-sell','test');
  if(scenario==='broker-unavailable'){const original=f.broker.account;f.broker.account=async()=>({...await original(),cash:'100',buying_power:'100'})}
  const account=f.store.account('alice'),id='cash-reuse',body={symbol:'AAPL',qty:'2',side:'buy',type:'limit',limit_price:'100',client_order_id:id};
  assert.equal(await f.engine.submit(account,{id,symbol:'AAPL',style:'day',version:f.store.release().id,kind:'entry',body,reason:'cash guard'},f.broker),scenario==='available');assert.equal(f.submissions.length,scenario==='available'?1:0);assert.equal(f.store.cashAvailable(account,calendar,clock.timestamp).available,scenario==='sale-unfilled'?100:1009);
 }finally{f.close()}
 }
})
