import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import dotenv from 'dotenv'
import {exportCheckpoint,migrateOwner} from '../services/paper/checkpoint.mjs'
import {CloudLease} from '../services/paper/cloud.mjs'
import {cloudDatabase} from '../lib/deployment/database.mjs'
const env=dotenv.parse(readFileSync('.env.hosted')),paper=dotenv.parse(readFileSync('.env.paper'))
const owners=(env.OWNER_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean)
const stage=process.argv.includes('--stage')
const source=new DatabaseSync(resolve('.paper-data/paper.sqlite'),{readOnly:true});let checkpoint
try{source.exec('BEGIN');checkpoint=exportCheckpoint({db:source});source.exec('COMMIT')}finally{source.close()}
console.log(JSON.stringify({mode:stage?'stage paused cloud copy':'inspect only',accounts:checkpoint.tables.accounts.length,fills:checkpoint.tables.fills.length,allocations:checkpoint.tables.allocations.length,intents:checkpoint.tables.intents.length},null,2))
if(stage){
 if(owners.length!==1)throw new Error('Set exactly one verified Clerk owner for the initial history migration.')
 if(env.CLOUD_PAPER_EXECUTION!=='false')throw new Error('Cloud execution must be explicitly disabled during staging.')
 if(env.PAPER_ENCRYPTION_KEY!==paper.PAPER_ENCRYPTION_KEY)throw new Error('The original paper encryption key must be preserved.')
 const owner=owners[0],identity=await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(owner)}`,{headers:{Authorization:`Bearer ${env.CLERK_SECRET_KEY}`},signal:AbortSignal.timeout(10000)})
 if(!identity.ok)throw new Error('The destination owner could not be verified with Clerk.')
 checkpoint=migrateOwner(checkpoint,'local_owner',owner)
 for(const account of checkpoint.tables.accounts)account.active=0
 const database=cloudDatabase(env),lease=new CloudLease(database)
 const claim=await lease.claim();if(claim.busy)throw new Error('Cloud monitoring is busy. Retry staging after it finishes.')
 try{
  const known=new Set(checkpoint.tables.accounts.map(a=>a.account_id))
  if((claim.body.tables.accounts??[]).some(a=>!known.has(a.account_id)))throw new Error('Cloud accounts differ. Their history will not be overwritten.')
  await lease.save({...checkpoint,runtime:{stagedAt:new Date().toISOString(),source:'local paper history',executionPaused:true}})
 }finally{await lease.release()}
 const research=new DatabaseSync(resolve('.research-data/jobs.sqlite'),{readOnly:true})
 try{
  const jobs=research.prepare("SELECT * FROM jobs WHERE owner='local_owner' AND status IN ('completed','failed','cancelled')").all().map(row=>({id:row.id,owner_id:owner,symbol:row.symbol,analysis_date:row.analysis_date,status:row.status,stage:row.stage,created_at:row.created,updated_at:row.updated,saved:!!row.saved,report:row.report?JSON.parse(row.report):null,error:row.error}))
  if(jobs.length)await database('research_cloud_jobs?on_conflict=id',{method:'POST',body:jobs,headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}})
  console.log(`Staged paused paper history and ${jobs.length} finished research records. Local execution is unchanged.`)
 }finally{research.close()}
}
