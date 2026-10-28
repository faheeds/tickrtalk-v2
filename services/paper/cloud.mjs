import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {PaperStore} from './store.mjs'
import {PaperEngine} from './engine.mjs'
import {paperBroker} from './broker.mjs'
import {createPaperActions} from './actions.mjs'
import {exportCheckpoint,importCheckpoint} from './checkpoint.mjs'
import {cloudDatabase} from '../../lib/deployment/database.mjs'

export class CloudLease {
 constructor(database,{generation=null}={}){this.db=database;this.generation=generation;this.holder=randomUUID();this.revision=null}
 async claim(){const result=await this.db('rpc/paper_cloud_claim',{method:'POST',body:{p_holder:this.holder,p_generation:this.generation}});if(result.busy||result.stopped)return result;this.revision=result.revision;return result}
 async save(body){
  if(this.revision===null)throw new Error('No cloud paper lease.')
  // Record the request start, not the response time: delayed replies cannot extend a stale lease locally.
  const started=performance.now()
  this.revision=await this.db('rpc/paper_cloud_save',{method:'POST',body:{p_holder:this.holder,p_revision:this.revision,p_body:body,p_generation:this.generation}})
  if(performance.now()-started>30000)throw new Error('Cloud checkpoint confirmation was too slow. No broker mutation is allowed.')
 }
 async release(){if(this.revision!==null)await this.db('rpc/paper_cloud_release',{method:'POST',body:{p_holder:this.holder}})}
}
export function guardedBroker(broker,checkpoint,{enabled=()=>process.env.CLOUD_PAPER_EXECUTION==='true'}={}){
 return new Proxy(broker,{get(target,name){const method=target[name];if(typeof method!=='function')return method;if(!['submit','cancel'].includes(name))return method.bind(target);return async(...args)=>{if(!enabled())throw new Error('Cloud paper execution is awaiting the verified cutover.');await checkpoint();return method.apply(target,args)}}})
}
async function workspace(body,lease,{key=process.env.PAPER_ENCRYPTION_KEY,database}={}){
 const directory=mkdtempSync(join(tmpdir(),'tickrtalk-cloud-'));let store
 try{
  store=new PaperStore(directory,key);importCheckpoint(store,body)
  store.cloudRuntime=body.runtime??{}
  const flush=()=>lease.save({...exportCheckpoint(store),runtime:store.cloudRuntime})
  const engine=new PaperEngine(store,{brokerFactory:credentials=>guardedBroker(paperBroker(credentials),flush),screeningUrl:process.env.AAOIFI_URL??'',scanLimit:1,scanOffset:body.runtime?.styleCursor??0})
  const service=createPaperActions({store,engine,token:'cloud-internal-not-a-network-endpoint',scheduleTick:()=>{}})
  return {store,engine,dispatch:service.dispatch,flush,close(){engine.close();store.close();rmSync(directory,{recursive:true,force:true})}}
 }catch(error){store?.close();rmSync(directory,{recursive:true,force:true});throw error}
}
export async function cloudPaperAction(user,owner,action,input={},{database=cloudDatabase(),key}={}){
 const readonly=action==='status',lease=new CloudLease(database);let context
 try{
  let body
  if(readonly){const rows=await database('paper_cloud_state?id=eq.1&select=body');body=rows[0]?.body;if(!body)throw new Error('Cloud paper migration has not been initialized.')}
  else{const claim=await lease.claim();if(claim.busy)throw Object.assign(new Error('Paper monitoring is reconciling. Please try this action again shortly.'),{status:409});body=claim.body}
  context=await workspace(body,lease,{key})
  if(!readonly&&process.env.CLOUD_PAPER_EXECUTION!=='true'&&['authorize','smoke','flatten','scan'].includes(action))throw Object.assign(new Error('Cloud paper execution is awaiting the verified cutover.'),{status:409})
  const result=await context.dispatch(user,owner,action,input)
  if(readonly)result.worker={...result.worker,runtime:'cloud',nextCheckAt:body.runtime?.nextCheckAt??null}
  if(!readonly)await context.flush()
  return result
 }finally{context?.close();if(!readonly)await lease.release()}
}
export async function cloudPaperTick(generation,{database=cloudDatabase(),key}={}){
 const lease=new CloudLease(database,{generation}),claim=await lease.claim()
 if(claim.stopped)return {stop:true,delay:60000}
 if(claim.busy)return {stop:false,delay:60000}
 let context
 try{
  context=await workspace(claim.body,lease,{key})
  if(process.env.CLOUD_PAPER_EXECUTION==='true')await context.engine.tick()
  else{context.store.heartbeat();for(const account of context.store.accounts())await context.engine.refresh(account)}
  const accounts=context.store.accounts(),open=accounts.some(a=>a.snapshot?.clock?.is_open),next=accounts.map(a=>Date.parse(a.snapshot?.nextOpen)).filter(Number.isFinite).sort((a,b)=>a-b)[0]
  // No background timers or sockets. The durable workflow sleeps between bounded checks.
  const delay=open?60000:next?Math.max(60000,Math.min(86400000,next-Date.now()-60000)):3600000
  context.store.cloudRuntime={styleCursor:((claim.body.runtime?.styleCursor??0)+1)%6,nextCheckAt:new Date(Date.now()+delay).toISOString(),checkedAt:new Date().toISOString(),deploymentId:process.env.VERCEL_DEPLOYMENT_ID??null}
  await context.flush()
  return {stop:false,delay}
 }finally{context?.close();await lease.release()}
}
