import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PaperStore} from '../services/paper/store.mjs'
import {PaperEngine} from '../services/paper/engine.mjs'
import {createPaperActions} from '../services/paper/actions.mjs'
import {DEFAULT_DRAFT,validateDraft,eastern} from '../services/paper/core.mjs'
import {exportCheckpoint,importCheckpoint} from '../services/paper/checkpoint.mjs'
import {buildPerformance} from '../lib/paper/performance.mjs'

function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'paper-styles-')),store=new PaperStore(directory,'b'.repeat(64)),orders=new Map(),submissions=[]
 let cash=10000
 const clock={timestamp:new Date().toISOString(),is_open:true,next_open:new Date(Date.now()+86400000).toISOString()}
 const broker={account:async()=>({id:'paper',status:'ACTIVE',cash:String(cash),equity:'10000',buying_power:String(cash),multiplier:'1',short_market_value:'0'}),positions:async()=>[],orders:async()=>[...orders.values()].filter(o=>o.status==='new'),clock:async()=>clock,calendar:async()=>[{date:eastern(clock.timestamp).date,open:'09:30',close:'16:00'}],asset:async()=>({class:'us_equity',tradable:true,status:'active'}),submit:async body=>{submissions.push(body);const order={...body,id:body.client_order_id,status:'new',filled_qty:'0'};orders.set(order.id,order);return order},byClient:async id=>orders.get(id),order:async id=>orders.get(id),cancel:async id=>{orders.get(id).status='canceled'}}
 const engine=new PaperEngine(store,{brokerFactory:()=>broker}),{dispatch}=createPaperActions({store,engine,token:'test',scheduleTick:()=>{}})
 store.connect('alice','paper',{key:'test',secret:'test'});store.publish(validateDraft({...DEFAULT_DRAFT,risk:{...DEFAULT_DRAFT.risk,maxBudget:10000}}),'owner');store.authorize('alice','day',1000)
 return {store,engine,dispatch,broker,orders,submissions,setCash:value=>{cash=value},close(){engine.close();store.close();rmSync(directory,{recursive:true,force:true})}}
}

test('three styles run independently with custom amounts and independent pause controls',async()=>{
 const f=fixture();try{
  await f.dispatch('alice',false,'authorize',{style:'swing',budget:1250.75,consent:true})
  await f.dispatch('alice',false,'authorize',{style:'longterm',budget:749.25,consent:true})
  let status=await f.dispatch('alice',false,'status',{})
  assert.equal(status.styles.filter(a=>a.active).length,3);assert.equal(status.totalAllocated,3000)
  await f.dispatch('alice',false,'pause',{style:'swing'})
  assert.equal(f.store.account('alice','swing').active,false)
  assert.equal(f.store.account('alice','day').active,true)
  assert.equal(f.store.account('alice','longterm').active,true)
  assert.equal(f.store.account('alice').active,true)
  await f.dispatch('alice',false,'authorize',{style:'swing',budget:1250.75,consent:true})
  const seen=[];f.engine.scan=async account=>{seen.push(account.style);return {signals:[]}}
  await f.engine.tick();assert.deepEqual(seen.sort(),['day','longterm','swing'])
 }finally{f.close()}
})

test('shared cash cannot be assigned twice, including funds belonging to a paused style',async()=>{
 const f=fixture();try{
  f.setCash(1500)
  await assert.rejects(f.dispatch('alice',false,'authorize',{style:'swing',budget:600,consent:true}),/unallocated broker cash/)
  await f.dispatch('alice',false,'pause',{style:'day'})
  await assert.rejects(f.dispatch('alice',false,'authorize',{style:'longterm',budget:600,consent:true}),/unallocated broker cash/)
  await f.dispatch('alice',false,'authorize',{style:'swing',budget:500,consent:true})
  assert.equal((await f.dispatch('alice',false,'status',{})).unallocatedCash,0)
  await assert.rejects(f.dispatch('alice',false,'authorize',{style:'day',budget:900,consent:true}),/current allocation/)
 }finally{f.close()}
})

test('adding funds preserves the starting allocation and does not become profit',async()=>{
 const f=fixture();try{
  const original=f.store.ensureAllocation(f.store.account('alice','day'))
  await f.dispatch('alice',false,'authorize',{style:'day',budget:2500.50,consent:true})
  const allocation=f.store.ensureAllocation(f.store.account('alice','day'))
  assert.equal(allocation.id,original.id);assert.equal(allocation.started,original.started);assert.equal(allocation.capital,1000)
  assert.equal(f.store.funding(allocation)[0].amount,1500.5)
  const now=new Date().toISOString();f.store.snapshot('alice',{observedAt:now,positions:[]})
  const performance=f.store.performance('alice',now).day
  assert.equal(performance.capital,1000);assert.equal(performance.fundedCapital,2500.5);assert.equal(performance.value,2500.5);assert.equal(performance.realized,0);assert.equal(performance.unrealized,0)
  assert.equal(f.store.cashAvailable(f.store.account('alice','day'),[],now).available,2500.5)
 }finally{f.close()}
})

test('a new style cannot bypass its wallet or spend another style’s pending order reservation',async()=>{
 const f=fixture();try{
  await f.dispatch('alice',false,'authorize',{style:'swing',budget:2000,consent:true})
  const submit=(style,symbol,qty,id)=>f.engine.submit(f.store.account('alice',style),{id,symbol,style,version:f.store.release().id,kind:'entry',body:{client_order_id:id,symbol,qty:String(qty),side:'buy',type:'limit',limit_price:'100'},reason:'test'},f.broker)
  assert.equal(await submit('day','AAPL',11,'too-much'),false)
  assert.equal(await submit('day','AAPL',8,'day-entry'),true)
  assert.equal(await submit('swing','AAPL',1,'overlap'),false)
  f.setCash(1000)
  assert.equal(await submit('swing','MSFT',3,'shared-cash'),false)
  assert.equal(await submit('swing','MSFT',2,'swing-entry'),true)
  await f.dispatch('alice',false,'pause',{style:'day'});await f.engine.cancelEmpty(f.store.account('alice'),f.broker)
  assert.equal(f.orders.get('day-entry').status,'canceled');assert.equal(f.orders.get('swing-entry').status,'new')
 }finally{f.close()}
})

test('legacy cloud checkpoints migrate one authorization and v2 retains all styles and funding',()=>{
 const f=fixture(),directory=mkdtempSync(join(tmpdir(),'paper-restored-')),restored=new PaperStore(directory,'b'.repeat(64))
 try{
  const legacy=exportCheckpoint(f.store);legacy.version=1;delete legacy.tables.style_authorizations;delete legacy.tables.allocation_funding
  importCheckpoint(restored,legacy);assert.deepEqual(restored.authorizations('alice').map(a=>a.style),['day'])
  const original=restored.ensureAllocation(restored.account('alice','day'));restored.authorize('alice','day',2500);restored.authorize('alice','swing',500)
  const checkpoint=exportCheckpoint(restored);assert.equal(checkpoint.version,2)
  importCheckpoint(f.store,checkpoint);assert.equal(f.store.authorizations('alice').length,2)
  assert.equal(f.store.ensureAllocation(f.store.account('alice','day')).id,original.id)
  assert.equal(f.store.funding(original)[0].amount,1500)
 }finally{restored.close();rmSync(directory,{recursive:true,force:true});f.close()}
})

test('capital additions on later dates and after a daily mark do not inflate returns',()=>{
 const performance=buildPerformance({capital:1000,started:'2026-10-13T13:00:00Z',fills:[],funding:[{amount:2500,time:'2026-10-15T16:00:00Z'}],observations:[{day:'2026-10-15',value:1000,observedAt:'2026-10-15T15:00:00Z'}],now:'2026-10-15T17:00:00Z'})
 assert.equal(performance.points[0].value,1000);assert.equal(performance.value,3500);assert.equal(performance.unrealized,0);assert.equal(performance.realized,0)
})
