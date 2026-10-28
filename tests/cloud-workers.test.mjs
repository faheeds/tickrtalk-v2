import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {PaperStore} from '../services/paper/store.mjs'
import {exportCheckpoint,importCheckpoint,migrateOwner} from '../services/paper/checkpoint.mjs'
import {CloudLease,guardedBroker} from '../services/paper/cloud.mjs'
import {researchStep,failResearchJob,publicCloudJob,researchAction} from '../services/research/cloud.mjs'
import {cloudDatabase} from '../lib/deployment/database.mjs'

test('database handles successful void RPC replies as well as JSON values',async()=>{
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://database.example',SUPABASE_SERVICE_ROLE_KEY:'private-test-key'}
 for(const [body,status,expected] of [['',200,null],[null,204,null],['null',200,null],['3',200,3],['[]',200,[]]]){
  const database=cloudDatabase(env,async()=>new Response(body,{status}))
  assert.deepEqual(await database('rpc/paper_cloud_release',{method:'POST',body:{p_holder:randomUUID()}}),expected)
 }
})

test('PostgreSQL leases fence competing and expired writers; customer roles cannot read cloud state',async()=>{
 const db=new PGlite()
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;')
  await db.exec(readFileSync('supabase/migrations/20261015_cloud_workers.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20261015_paper_styles.sql','utf8'))
  const rpc=async(path,{body}={})=>{const args=Object.values(body),name=path.split('/')[1];const result=await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args.map(a=>a&&typeof a==='object'?JSON.stringify(a):a));return result.rows[0]?.value}
  const first=new CloudLease(rpc),second=new CloudLease(rpc)
  const claimed=await first.claim();assert.equal(claimed.body.version,1);assert.equal((await second.claim()).busy,true)
  await first.save({version:1,tables:{fills:[]}})
  await first.save({version:2,tables:{fills:[]}})
  await assert.rejects(()=>first.save({version:1,tables:{fills:[]}}),/downgrade/)
  await db.exec("update public.paper_cloud_state set lease_until=clock_timestamp()-interval '1 second'")
  await second.claim();await assert.rejects(()=>first.save({version:1,tables:{}}),/lease lost/)
  const generation=randomUUID();await db.query('update public.paper_cloud_state set generation=$1',[generation]);await second.release()
  const worker=new CloudLease(rpc,{generation});await worker.claim()
  await db.query('update public.paper_cloud_state set generation=$1',[randomUUID()]);await assert.rejects(()=>worker.save({version:1,tables:{}}),/lease lost/)
  await worker.release();assert.equal((await worker.claim()).stopped,true)
  await db.exec('set role anon');await assert.rejects(()=>db.query('select body from public.paper_cloud_state'),/permission denied/);await db.exec('reset role')
  const job=randomUUID();await db.query('select public.research_cloud_create($1,$2,$3)',[job,'user_one','AAPL'])
  await assert.rejects(()=>db.query('select public.research_cloud_create($1,$2,$3)',[randomUUID(),'user_one','BMY']),/unique/)
  await db.exec('set role authenticated');await assert.rejects(()=>db.query('select report from public.research_cloud_jobs'),/permission denied/)
 }finally{await db.close()}
})

test('research timeout stops the existing sandbox; exhausted retries free the job without overwriting a cancellation',async()=>{
 const row={id:randomUUID(),status:'running',sandbox_name:'sbx_existing',deadline:new Date(Date.now()-1000).toISOString()},stopped=[]
 const database=async(path,options={})=>{
  if(options.method==='PATCH'){
   if(['queued','running'].includes(row.status))Object.assign(row,options.body)
   return null
  }
  return [structuredClone(row)]
 }
 const sandboxFactory=async options=>{assert.deepEqual(options,{name:'sbx_existing'});return {stop:async()=>stopped.push(options.name)}}
 assert.equal((await researchStep(row.id,{database,sandboxFactory})).done,true)
 assert.equal(row.status,'failed');assert.deepEqual(stopped,['sbx_existing'])
 row.status='running';await failResearchJob(row.id,{database,sandboxFactory});assert.equal(row.status,'failed')
 row.status='cancelled';row.error=null;await failResearchJob(row.id,{database,sandboxFactory});assert.equal(row.status,'cancelled');assert.equal(row.error,null)
 // A sandbox that has already expired must not prevent the database failure state from being saved.
 row.status='running';await failResearchJob(row.id,{database,sandboxFactory:async()=>{throw Error('gone')}});assert.equal(row.status,'failed')
})
test('paper checkpoints preserve encrypted credentials, original allocation and uncertain order reconciliation',()=>{
 const dirs=[mkdtempSync(join(tmpdir(),'paper-original-')),mkdtempSync(join(tmpdir(),'paper-cloud-'))],stores=[]
 try{
  const first=new PaperStore(dirs[0],'a'.repeat(64));stores.push(first);first.connect('local_owner','account',{key:'private-test-key',secret:'private-test-secret'});first.authorize('local_owner','day',1000)
  const allocation=first.ensureAllocation(first.account('local_owner'));first.prepare({id:'uncertain',user:'local_owner',symbol:'AAPL',style:'day',version:'v',kind:'entry',body:{qty:'1'},reason:'test'})
  const checkpoint=migrateOwner(exportCheckpoint(first),'local_owner','user_owner');assert.ok(!JSON.stringify(checkpoint).includes('private-test-secret'))
  const restored=new PaperStore(dirs[1],'a'.repeat(64));stores.push(restored);importCheckpoint(restored,checkpoint)
  assert.equal(restored.account('local_owner'),null);assert.equal(restored.account('user_owner').budget,1000);assert.equal(restored.ensureAllocation(restored.account('user_owner')).started,allocation.started)
  assert.equal(restored.decrypt(restored.account('user_owner').credentials).secret,'private-test-secret');assert.equal(restored.intent('uncertain').status,'unknown')
 }finally{for(const store of stores)store.close();for(const dir of dirs)rmSync(dir,{recursive:true,force:true})}
})
test('broker calls require a successful durable checkpoint before submission or cancellation',async()=>{
 const events=[],broker={submit:async()=>{events.push('broker');return {}},cancel:async()=>events.push('cancel')}
 const guarded=guardedBroker(broker,async()=>events.push('durable'),{enabled:()=>true});await guarded.submit({});assert.deepEqual(events,['durable','broker'])
 await assert.rejects(()=>guardedBroker(broker,async()=>{throw Error('storage unavailable')},{enabled:()=>true}).submit({}),/storage/);assert.equal(events.length,2)
 await assert.rejects(()=>guardedBroker(broker,async()=>{}, {enabled:()=>false}).cancel('id'),/cutover/);assert.equal(events.length,2)
})
test('research retries reuse the running sandbox job and cancellation never publishes a report',async()=>{
 const row={id:randomUUID(),owner_id:'user_one',symbol:'AAPL',analysis_date:'2026-10-14',status:'queued',stage:'Waiting',created_at:new Date().toISOString(),runner_started:false},files=new Map();let commands=0,stops=0
 const db=async(path,options={})=>{if(options.method==='PATCH'){if(!path.includes('status=eq.')||path.includes('status=eq.'+row.status))Object.assign(row,options.body);return null}return path.includes('owner_id=eq.user_other')?[]:[structuredClone(row)]}
 const sandbox={name:'research-test',mkDir:async()=>{},writeFiles:async rows=>{for(const r of rows)files.set(r.path,r.content)},readFileToBuffer:async({path})=>files.get(path)??null,runCommand:async()=>{commands++;files.set('/vercel/sandbox/job/started',Buffer.from(''))},stop:async()=>{stops++}}
 const factory=async()=>sandbox
 await researchStep(row.id,{database:db,sandboxFactory:factory});await researchStep(row.id,{database:db,sandboxFactory:factory});assert.equal(commands,1)
 const view=publicCloudJob(row,true);assert.equal(view.sandbox_name,undefined);assert.equal(view.owner_id,undefined)
 await assert.rejects(()=>researchAction('user_other','GET',row.id,null,{database:db}),/not found/)
 row.status='cancelled';await researchStep(row.id,{database:db,sandboxFactory:factory});assert.equal(stops,1);assert.equal(row.report,undefined)
})
