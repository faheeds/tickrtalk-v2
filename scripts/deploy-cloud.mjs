import {readFileSync,existsSync} from 'node:fs'
import {createConnection} from 'node:net'
import {spawnSync} from 'node:child_process'
import dotenv from 'dotenv'
import {checkProductionConfig} from '../lib/deployment/config.mjs'
import {cloudDatabase} from '../lib/deployment/database.mjs'
const privateSettings=dotenv.parse(readFileSync('.env.hosted'))
const env={...privateSettings,PAPER_RUNTIME:'cloud',RESEARCH_RUNTIME:'cloud',CLOUD_PAPER_EXECUTION:privateSettings.CLOUD_PAPER_EXECUTION==='true'?'true':'false',ENABLE_LOCAL_PAPER:'false',ENABLE_LOCAL_RESEARCH:'false',ENABLE_LIVE_EXECUTION:'false',ENABLE_PAID_CHECKOUT:'false',NEXT_PUBLIC_DEPLOYMENT_PREVIEW:'false'}
if(env.CLOUD_PAPER_EXECUTION==='true'){
 if(!existsSync('.paper-data/cloud-cutover.json'))throw new Error('Retire the local paper worker and verify the cloud cutover before enabling cloud orders.')
 const localRunning=await new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port:8003});const finish=value=>{socket.destroy();resolve(value)};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(true))})
 if(localRunning)throw new Error('The local paper port is still active. Cloud order execution cannot be published concurrently.')
}
const report=checkProductionConfig(env)
if(!report.ready){console.log(JSON.stringify(report,null,2));process.exit(1)}
if(!process.argv.includes('--publish')){console.log('Production configuration is complete. Publication is ready for database and service verification; no cloud settings changed.');process.exit(0)}
const database=cloudDatabase(env)
for(const path of ['paper_cloud_state?id=eq.1&select=revision','research_cloud_jobs?select=id&limit=0','users?select=id,snaptrade_user_secret&limit=0','brokerage_connections?select=id,user_id&limit=0'])await database(path)
for(const owner of env.OWNER_USER_IDS.split(',').map(value=>value.trim())){
 const response=await fetch('https://api.clerk.com/v1/users/'+encodeURIComponent(owner),{headers:{Authorization:`Bearer ${env.CLERK_SECRET_KEY}`},signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw new Error('Owner verification failed. Cloud settings were not changed.')
}
const project=JSON.parse(readFileSync('.vercel/project.json')),auth=JSON.parse(readFileSync('.vercel-cli/auth.json'))
const allowed=['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','OWNER_USER_IDS','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','ENCRYPTION_KEY','SNAPTRADE_CLIENT_ID','SNAPTRADE_CONSUMER_KEY','AAOIFI_URL','ANTHROPIC_API_KEY','TRADINGAGENTS_LLM_PROVIDER','TRADINGAGENTS_DEEP_THINK_LLM','TRADINGAGENTS_QUICK_THINK_LLM','PAPER_ENCRYPTION_KEY','NEXT_PUBLIC_APP_URL','NEXT_PUBLIC_CLERK_SIGN_IN_URL','NEXT_PUBLIC_CLERK_SIGN_UP_URL','NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL','NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL','PAPER_RUNTIME','RESEARCH_RUNTIME','CLOUD_PAPER_EXECUTION','ENABLE_LOCAL_PAPER','ENABLE_LOCAL_RESEARCH','ENABLE_LIVE_EXECUTION','ENABLE_PAID_CHECKOUT','NEXT_PUBLIC_DEPLOYMENT_PREVIEW']
const response=await fetch(`https://api.vercel.com/v10/projects/${encodeURIComponent(project.projectId)}/env?upsert=true&teamId=${encodeURIComponent(project.orgId)}`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify(allowed.filter(key=>env[key]).map(key=>({key,value:env[key],type:'encrypted',target:['production']}))),signal:AbortSignal.timeout(20000)})
if(!response.ok)throw new Error(`Vercel rejected production settings (${response.status}). No secret values were printed.`)
const result=await response.json();if(result.failed?.length)throw new Error('Vercel could not save all production settings. Publication stopped.')
console.log(env.CLOUD_PAPER_EXECUTION==='true'?'Production variables saved privately. Cloud paper execution is enabled; customer authorizations and risk limits still apply.':'Production variables saved privately. Paper execution remains disabled for migration validation.')
const prepared=spawnSync(process.execPath,['scripts/prepare-cloud-deployment.mjs'],{stdio:'inherit'});if(prepared.status!==0)process.exit(1)
const command=process.platform==='win32'?'npx.cmd':'npx'
const deployed=spawnSync(command,['vercel@64.2.0','deploy','--prod','--yes','--scope','faheedsubhani-7502s-projects','--global-config','../.vercel-cli'],{cwd:'.vercel-staging',stdio:'inherit',shell:process.platform==='win32',env:{...process.env,NO_UPDATE_NOTIFIER:'1'}})
if(deployed.status!==0)process.exitCode=1
