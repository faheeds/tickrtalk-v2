import {readFileSync} from 'node:fs'
import {createDecipheriv} from 'node:crypto'
import dotenv from 'dotenv'
import {cloudDatabase} from '../../lib/deployment/database.mjs'
export async function ownerMarketReader(){
 const env=dotenv.parse(readFileSync('.env.hosted')),[{body}]=await cloudDatabase(env)('paper_cloud_state?id=eq.1&select=body')
 const account=body.tables.accounts.find(a=>a.user===env.OWNER_USER_IDS.split(',')[0].trim())
 if(!account)throw new Error('Owner paper connection unavailable.')
 const [iv,tag,bytes]=account.credentials.split(':'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(env.PAPER_ENCRYPTION_KEY,'hex'),Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'))
 const credentials=JSON.parse(Buffer.concat([cipher.update(Buffer.from(bytes,'hex')),cipher.final()]).toString('utf8'))
 const headers={'APCA-API-KEY-ID':credentials.key,'APCA-API-SECRET-KEY':credentials.secret};let previous=0
 return async function read(url){
  const parsed=new URL(url),allowed=parsed.origin==='https://data.alpaca.markets'&&['/v2/stocks/bars','/v2/stocks/quotes','/v1beta1/news'].includes(parsed.pathname)||parsed.origin==='https://paper-api.alpaca.markets'&&['/v2/assets','/v2/calendar'].includes(parsed.pathname)
  if(!allowed)throw new Error('Only read-only market-data endpoints are permitted.')
  for(let attempt=0;attempt<5;attempt++){
   const wait=Math.max(0,350-(Date.now()-previous));previous=Date.now()+wait;if(wait)await new Promise(r=>setTimeout(r,wait))
   const response=await fetch(url,{method:'GET',headers,signal:AbortSignal.timeout(60000)})
   if(response.status===429||response.status>=500){await new Promise(r=>setTimeout(r,5000));continue}
   if(!response.ok)throw new Error('Market-data request rejected ('+response.status+'). No account settings were changed.')
   return response.json()
  }
  throw new Error('Market-data retries exhausted.')
 }
}
