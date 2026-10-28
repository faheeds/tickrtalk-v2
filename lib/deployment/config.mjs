export const productionGroups={
  identity:['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','CLERK_SECRET_KEY','OWNER_USER_IDS'],
  storage:['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','ENCRYPTION_KEY'],
  brokerage:['SNAPTRADE_CLIENT_ID','SNAPTRADE_CONSUMER_KEY'],
  screening:['AAOIFI_URL'],
  research:['RESEARCH_API_URL','RESEARCH_API_KEY'],
  paper:['PAPER_API_URL','PAPER_SERVICE_TOKEN'],
}
export function checkProductionConfig(env){
  const definitions={...productionGroups,...(env.PAPER_RUNTIME==='cloud'?{paper:['PAPER_ENCRYPTION_KEY']}:{ }),...(env.RESEARCH_RUNTIME==='cloud'?{research:['ANTHROPIC_API_KEY','TRADINGAGENTS_LLM_PROVIDER','TRADINGAGENTS_DEEP_THINK_LLM','TRADINGAGENTS_QUICK_THINK_LLM']}:{ })}
  const groups=Object.fromEntries(Object.entries(definitions).map(([group,fields])=>[group,{ready:fields.every(name=>!!env[name]?.trim()),missing:fields.filter(name=>!env[name]?.trim())}]))
  const errors=[],warnings=[]
  for(const field of ['NEXT_PUBLIC_SUPABASE_URL','AAOIFI_URL','RESEARCH_API_URL','PAPER_API_URL','NEXT_PUBLIC_APP_URL']){
    if(!env[field])continue
    try{const url=new URL(env[field]);if(url.protocol!=='https:'||url.username||url.password||['localhost','127.0.0.1','0.0.0.0','[::1]'].includes(url.hostname))errors.push(`${field} must be a public HTTPS URL without embedded credentials.`)}catch{errors.push(`${field} is not a valid URL.`)}
  }
  for(const flag of ['ENABLE_LOCAL_PAPER','ENABLE_LOCAL_RESEARCH','ENABLE_LIVE_EXECUTION','ENABLE_PAID_CHECKOUT'])if(env[flag]==='true')errors.push(`${flag} must stay disabled for this paper-only release.`)
  if(env.NEXT_PUBLIC_DEPLOYMENT_PREVIEW==='true')errors.push('The hosted production configuration still enables the public preview label.')
  for(const field of ['ENCRYPTION_KEY','RESEARCH_API_KEY','PAPER_SERVICE_TOKEN'])if(env[field]&&env[field].length<32)errors.push(`${field} needs at least 32 characters.`)
  if(env.OWNER_USER_IDS&&!env.OWNER_USER_IDS.split(',').every(id=>/^user_[A-Za-z0-9]+$/.test(id.trim())))errors.push('OWNER_USER_IDS must contain Clerk user IDs separated by commas.')
  const publicKey=env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,secretKey=env.CLERK_SECRET_KEY
  if(publicKey&&secretKey){const mode=publicKey.startsWith('pk_live_')?'live':publicKey.startsWith('pk_test_')?'test':null;if(!mode||!secretKey.startsWith(`sk_${mode}_`))errors.push('Clerk keys must be a matching publishable and secret key pair.');else if(mode==='test')warnings.push('Clerk uses test keys. Production domain and live keys are still needed before a customer release.')}
  if(env.PAPER_RUNTIME==='cloud'&&env.PAPER_ENCRYPTION_KEY&&!/^[a-f0-9]{64}$/i.test(env.PAPER_ENCRYPTION_KEY))errors.push('PAPER_ENCRYPTION_KEY must preserve the original 64-character hexadecimal key.')
  return {ready:Object.values(groups).every(group=>group.ready)&&errors.length===0,groups,errors,warnings}
}
