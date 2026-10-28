import test from 'node:test'
import assert from 'node:assert/strict'
import {checkProductionConfig,productionGroups} from '../lib/deployment/config.mjs'
function config(){const env=Object.fromEntries(Object.values(productionGroups).flat().map(field=>[field,'x'.repeat(40)]));for(const field of ['NEXT_PUBLIC_SUPABASE_URL','AAOIFI_URL','RESEARCH_API_URL','PAPER_API_URL','NEXT_PUBLIC_APP_URL'])env[field]='https://service.example.com';env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_live_example';env.CLERK_SECRET_KEY='sk_live_example';env.OWNER_USER_IDS='user_example';return env}
test('production checks reject local services and unsafe execution flags without exposing secrets',()=>{
 const env=config();assert.equal(checkProductionConfig(env).ready,true)
 assert.equal(checkProductionConfig({...env,PAPER_API_URL:'http://127.0.0.1:8003'}).ready,false)
 assert.equal(checkProductionConfig({...env,ENABLE_LOCAL_PAPER:'true'}).ready,false)
 assert.equal(checkProductionConfig({...env,ENABLE_LIVE_EXECUTION:'true'}).ready,false)
 assert.equal(checkProductionConfig({...env,CLERK_SECRET_KEY:'sk_test_other'}).ready,false)
 const report=checkProductionConfig({...env,RESEARCH_API_KEY:''});assert.deepEqual(report.groups.research.missing,['RESEARCH_API_KEY']);assert.ok(!JSON.stringify(report).includes(env.SUPABASE_SERVICE_ROLE_KEY))
})
