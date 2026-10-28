export function cloudDatabase(env=process.env,fetcher=fetch){
 const endpoint=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY
 if(!endpoint||!key)throw new Error('Cloud storage is not configured.')
 const base=new URL(endpoint);if(base.protocol!=='https:')throw new Error('Cloud storage requires HTTPS.')
 return async function request(path,{method='GET',body,headers={}}={}){
  const response=await fetcher(new URL('/rest/v1/'+path,base),{method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(10000)})
  if(!response.ok){const error=new Error(`Cloud storage rejected the operation (${response.status}).`);error.status=response.status;throw error}
  if(response.status===204)return null
  const text=await response.text()
  return text.trim()?JSON.parse(text):null
 }
}
