import test from 'node:test'
import assert from 'node:assert/strict'
import { generateLoginLink, listAccounts, SnapTradeError,getAccountActivityLedger,getAccountBalanceHistory } from '../lib/snaptrade.ts'

test('SnapTrade errors preserve recovery codes without exposing provider details', async t => {
 t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({code:'1083',detail:'private-provider-detail'}),{status:401,headers:{'content-type':'application/json'}}))
 await assert.rejects(listAccounts('test-user','test-secret'), error => {
  assert.ok(error instanceof SnapTradeError)
  assert.equal(error.status,401)
  assert.equal(error.code,'1083')
  assert.ok(!error.message.includes('private-provider-detail'))
  assert.ok(!error.message.includes('test-secret'))
  return true
 })
})

test('Journal portal requests read access and return the provider URL', async t => {
 t.mock.method(globalThis,'fetch',async (url,options) => {
  assert.equal(new URL(url).pathname,'/api/v1/snapTrade/login')
  assert.equal(new URL(url).searchParams.get('userId'),'test-user')
  assert.equal(new URL(url).searchParams.get('userSecret'),'test-secret')
  assert.ok(options.headers.Signature)
  assert.ok(options.signal instanceof AbortSignal)
  const body=JSON.parse(options.body)
  assert.equal(body.connectionType,'read')
  assert.equal(body.darkMode,true)
  assert.equal(body.immediateRedirect,true)
  assert.equal(body.customRedirect,'https://app.example/dashboard/accounts')
  return Response.json({redirectURI:'https://portal.example/connect'})
 })
 assert.deepEqual(await generateLoginLink('test-user','test-secret',{customRedirect:'https://app.example/dashboard/accounts'}),{redirectURI:'https://portal.example/connect'})
})

test('SnapTrade handles non-JSON provider failures safely',async t => {
 t.mock.method(globalThis,'fetch',async () => new Response('sensitive upstream response',{status:502}))
 await assert.rejects(listAccounts('test-user','test-secret'),error => error instanceof SnapTradeError && error.status===502 && error.code===null && !error.message.includes('sensitive'))
})

test('capital ledger follows activity pagination instead of assuming the first page is complete',async t=>{
 const offsets=[]
 t.mock.method(globalThis,'fetch',async url=>{
  const offset=Number(new URL(url).searchParams.get('offset'));offsets.push(offset)
  return Response.json({data:Array.from({length:offset?2:1000},(_,i)=>({id:String(offset+i)})),pagination:{total:1002}})
 })
 const result=await getAccountActivityLedger('test-user','test-secret','test-account','2024-01-01')
 assert.equal(result.activities.length,1002);assert.equal(result.complete,true);assert.deepEqual(offsets,[0,1000])
})

test('capital ledger marks the bounded import incomplete and protects contribution calculations',async t=>{
 let calls=0
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({data:Array.from({length:1000},(_,i)=>({id:String(i)})),pagination:{total:6000}})})
 const result=await getAccountActivityLedger('test-user','test-secret','test-account','2024-01-01')
 assert.equal(calls,5);assert.equal(result.complete,false)
})

test('history add-on restrictions preserve a safe status for the unavailable state',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({detail:'private'},{status:403}))
 await assert.rejects(getAccountBalanceHistory('test-user','test-secret','test-account'),error=>error instanceof SnapTradeError&&error.status===403&&!error.message.includes('private'))
})
