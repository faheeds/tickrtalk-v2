import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Sandbox} from '@vercel/sandbox'
import {cloudDatabase} from '../../lib/deployment/database.mjs'
export const RESEARCH_COMMIT='01477f9afb7a47b849ed4c9259d3a9a4738d9fda'
const terminal=new Set(['completed','cancelled','failed'])
export function cloudResearchHealth(env=process.env){
 const missing=['ANTHROPIC_API_KEY','TRADINGAGENTS_DEEP_THINK_LLM','TRADINGAGENTS_QUICK_THINK_LLM'].filter(k=>!env[k])
 if(env.TRADINGAGENTS_LLM_PROVIDER!=='anthropic')missing.push('Anthropic provider configuration')
 return {ready:missing.length===0,missing,engine:'TradingAgents',provider:'anthropic',deepModel:env.TRADINGAGENTS_DEEP_THINK_LLM??null,quickModel:env.TRADINGAGENTS_QUICK_THINK_LLM??null}
}
export function publicCloudJob(row,detail=false){return {id:row.id,symbol:row.symbol,analysisDate:row.analysis_date,status:row.status,stage:row.stage,createdAt:row.created_at,updatedAt:row.updated_at,saved:row.saved,error:row.error,...(detail?{report:row.report}: {})}}
export async function researchAction(owner,method,id,body,{database=cloudDatabase(),launch}={}){
 if(method==='GET'&&!id){const jobs=await database(`research_cloud_jobs?owner_id=eq.${encodeURIComponent(owner)}&order=created_at.desc&limit=100`);return {health:cloudResearchHealth(),jobs:jobs.map(row=>publicCloudJob(row))}}
 if(method==='POST'){
  if(!cloudResearchHealth().ready)throw Object.assign(new Error('Cloud TradingAgents configuration is incomplete.'),{status:503})
  if(!/^[A-Z][A-Z0-9.-]{0,19}$/.test(body?.symbol??''))throw Object.assign(new Error('Enter a valid stock symbol.'),{status:400})
  const job=randomUUID();await database('rpc/research_cloud_create',{method:'POST',body:{p_id:job,p_owner:owner,p_symbol:body.symbol}})
  try{await launch(job)}catch(error){await database(`research_cloud_jobs?id=eq.${job}&status=eq.queued`,{method:'PATCH',body:{status:'failed',stage:'Could not start',error:'The cloud research workflow could not start.'}});throw error}
  const rows=await database(`research_cloud_jobs?id=eq.${job}&owner_id=eq.${encodeURIComponent(owner)}`);return {job:publicCloudJob(rows[0],true)}
 }
 const path=`research_cloud_jobs?id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(owner)}`,rows=await database(path),row=rows[0]
 if(!row)throw Object.assign(new Error('Report not found.'),{status:404})
 if(method==='GET')return {job:publicCloudJob(row,true)}
 if(method==='PATCH'){
  if(typeof body?.saved!=='boolean'||row.status!=='completed')throw Object.assign(new Error('Only completed reports can be saved.'),{status:400})
  await database(path,{method:'PATCH',body:{saved:body.saved,updated_at:new Date().toISOString()}});return {job:publicCloudJob({...row,saved:body.saved},true)}
 }
 if(method==='DELETE'){
  await database(path+'&status=in.(queued,running)',{method:'PATCH',body:{status:'cancelled',stage:'Cancellation requested',updated_at:new Date().toISOString()}})
  return {cancelled:true}
 }
 throw Object.assign(new Error('Method not allowed.'),{status:405})
}
const readJson=async(sandbox,path)=>{const bytes=await sandbox.readFileToBuffer({path});return bytes?JSON.parse(bytes.toString()):null}
async function stopResearchSandbox(id,sandboxFactory){
 if(!id)return
 try{await (await sandboxFactory({name:id})).stop()}catch{}
}
export async function failResearchJob(id,{database=cloudDatabase(),sandboxFactory=options=>Sandbox.get(options)}={}){
 const path=`research_cloud_jobs?id=eq.${id}`,job=(await database(path))[0]
 if(!job)return
 await database(path+'&status=in.(queued,running)',{method:'PATCH',body:{status:'failed',stage:'Analysis stopped',error:'The cloud analyst team could not finish this report. You can try again.',updated_at:new Date().toISOString()}})
 await stopResearchSandbox(job.sandbox_name,sandboxFactory)
}
export async function researchStep(id,{database=cloudDatabase(),sandboxFactory=options=>options.runtime?Sandbox.getOrCreate(options):Sandbox.get(options)}={}){
 const path=`research_cloud_jobs?id=eq.${id}`,rows=await database(path),job=rows[0]
 if(!job)return {done:true}
 const name=`tickrtalk-research-${id}`
 if(terminal.has(job.status)){
  await stopResearchSandbox(job.sandbox_name,sandboxFactory)
  return {done:true}
 }
 const deadline=job.deadline??new Date(Date.now()+1500000).toISOString()
 if(Date.now()>Date.parse(deadline)){
  await database(path+'&status=in.(queued,running)',{method:'PATCH',body:{status:'failed',stage:'Analysis timed out',error:'The analyst team reached its time limit. You can run it again.',updated_at:new Date().toISOString()}})
  await stopResearchSandbox(job.sandbox_name,sandboxFactory)
  return {done:true}
 }
 const env=Object.fromEntries(['ANTHROPIC_API_KEY','TRADINGAGENTS_LLM_PROVIDER','TRADINGAGENTS_DEEP_THINK_LLM','TRADINGAGENTS_QUICK_THINK_LLM'].map(key=>[key,process.env[key]??'']))
 // Only an opaque job ID crosses Workflow step boundaries. Provider keys stay inside this step.
 const sandbox=job.sandbox_name?await sandboxFactory({name:job.sandbox_name}):await sandboxFactory({name,runtime:'python3.13',timeout:1800000,env})
 if(typeof sandbox.name!=='string'||!sandbox.name)throw new Error('Cloud sandbox did not return its persistent name.')
 if(!job.runner_started){
  const files=['runner.py','reports.py','cloud_boot.py','requirements.lock.txt'].map(file=>({path:`/vercel/sandbox/${file}`,content:readFileSync(resolve(process.cwd(),'services/research',file))}))
  const provenance=JSON.parse(readFileSync(resolve(process.cwd(),'services/research/vendor/provenance.json'),'utf8'))
  if(provenance.commit!==RESEARCH_COMMIT)throw new Error('TradingAgents package version mismatch.')
  files.push({path:'/vercel/sandbox/engine.tar',content:readFileSync(resolve(process.cwd(),'services/research/vendor/engine.tar'))},{path:'/vercel/sandbox/engine-provenance.json',content:Buffer.from(JSON.stringify(provenance))})
  files.push({path:'/vercel/sandbox/job/request.json',content:Buffer.from(JSON.stringify({symbol:job.symbol,analysisDate:job.analysis_date,provenance:{repository:'https://github.com/faheeds/TradingAgents_TauricResearch',commit:RESEARCH_COMMIT,workingTreeModified:false,provider:env.TRADINGAGENTS_LLM_PROVIDER,deepModel:env.TRADINGAGENTS_DEEP_THINK_LLM,quickModel:env.TRADINGAGENTS_QUICK_THINK_LLM}}))})
  await sandbox.mkDir('/vercel/sandbox/job');await sandbox.writeFiles(files)
  await database(path+'&status=eq.queued',{method:'PATCH',body:{status:'running',stage:'Preparing analyst team',sandbox_name:sandbox.name,deadline,runner_started:true,updated_at:new Date().toISOString()}})
  // Exclusive on-disk marker prevents a retried dispatch from running the LLM team twice.
 }
 const current=(await database(path))[0]
 if(!current||terminal.has(current.status)){await sandbox.stop();return {done:true}}
 if(!await sandbox.readFileToBuffer({path:'/vercel/sandbox/job/started'}))await sandbox.runCommand({cmd:'python3',args:['/vercel/sandbox/cloud_boot.py'],detached:true,timeoutMs:1500000})
 const done=await readJson(sandbox,'/vercel/sandbox/job/done.json')
 if(done){
  const report=done.success?await readJson(sandbox,'/vercel/sandbox/job/final.json'):null
  const success=!!report?.sections?.decision?.content
  await database(path+'&status=eq.running',{method:'PATCH',body:{status:success?'completed':'failed',stage:success?'Report ready':'Analysis stopped',report:success?report:null,error:success?null:'The analyst team could not complete this report.',updated_at:new Date().toISOString()}})
  await sandbox.stop();return {done:true}
 }
 const progress=await readJson(sandbox,'/vercel/sandbox/job/progress.json')
 if(progress?.stage)await database(path+'&status=eq.running',{method:'PATCH',body:{stage:String(progress.stage).slice(0,160),updated_at:new Date().toISOString()}})
 return {done:false}
}
