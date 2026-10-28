import {readFileSync} from 'node:fs'
import dotenv from 'dotenv'
import {checkProductionConfig} from '../lib/deployment/config.mjs'
const env={PAPER_RUNTIME:'cloud',RESEARCH_RUNTIME:'cloud',...dotenv.parse(readFileSync(new URL('../.env.hosted',import.meta.url)))}
const report=checkProductionConfig(env)
// Only setting names and readiness are printed. Secret values never appear.
console.log(JSON.stringify(report,null,2))
if(process.argv.includes('--verify')){
  const checks=[]
  for(const [table,columns] of [['users','id,snaptrade_user_secret'],['brokerage_connections','id,user_id,paper_mode,api_key_encrypted,api_secret_encrypted'],['owner_config_drafts','id,updated_by'],['paper_cloud_state','id,revision'],['research_cloud_jobs','id,status']]){
    if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)continue
    const url=new URL(`/rest/v1/${table}`,env.NEXT_PUBLIC_SUPABASE_URL);url.searchParams.set('select',columns);url.searchParams.set('limit','0')
    const response=await fetch(url,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`},signal:AbortSignal.timeout(10000)});checks.push({component:`Database ${table}`,passed:response.ok,status:response.status})
  }
  for(const owner of report.groups.identity.ready&&/^user_[A-Za-z0-9]+(,\s*user_[A-Za-z0-9]+)*$/.test(env.OWNER_USER_IDS)?env.OWNER_USER_IDS.split(',').map(id=>id.trim()):[]){
    const response=await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(owner)}`,{headers:{Authorization:`Bearer ${env.CLERK_SECRET_KEY}`},signal:AbortSignal.timeout(10000)});checks.push({component:'Owner identity',passed:response.ok,status:response.status})
  }
  console.log(JSON.stringify({connections:checks},null,2));if(checks.some(c=>!c.passed))process.exitCode=1
}
if(!report.ready)process.exitCode=1
