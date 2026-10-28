import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs'
import {createDecipheriv,createHash} from 'node:crypto'
import dotenv from 'dotenv'
import {cloudDatabase} from '../lib/deployment/database.mjs'
const protocol=JSON.parse(readFileSync('services/strategy-research/protocol.json','utf8'))
const root='.local-run/strategy-research/';mkdirSync(root,{recursive:true})
const env=dotenv.parse(readFileSync('.env.hosted'))
const [{body}]=await cloudDatabase(env)('paper_cloud_state?id=eq.1&select=body')
const owner=env.OWNER_USER_IDS.split(',')[0].trim(),account=body.tables.accounts.find(a=>a.user===owner)
if(!account)throw new Error('Owner paper connection unavailable.')
const [iv,tag,bytes]=account.credentials.split(':'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(env.PAPER_ENCRYPTION_KEY,'hex'),Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'))
const credentials=JSON.parse(Buffer.concat([cipher.update(Buffer.from(bytes,'hex')),cipher.final()]).toString('utf8'))
const headers={'APCA-API-KEY-ID':credentials.key,'APCA-API-SECRET-KEY':credentials.secret}
async function get(url){
 const parsed=new URL(url)
 if(!((parsed.origin==='https://data.alpaca.markets'&&parsed.pathname==='/v2/stocks/bars')||(parsed.origin==='https://paper-api.alpaca.markets'&&parsed.pathname==='/v2/calendar')))throw new Error('Only historical bars and market calendars are permitted.')
 for(let attempt=0;attempt<5;attempt++){
  const response=await fetch(url,{method:'GET',headers,signal:AbortSignal.timeout(60000)})
  if(response.status===429||response.status>=500){await new Promise(r=>setTimeout(r,5000));continue}
  if(!response.ok)throw new Error(`Historical data request rejected (${response.status}). No subscription or account setting was changed.`)
  return response.json()
 }
 throw new Error('Historical data retries exhausted.')
}
const calendar=await get(`https://paper-api.alpaca.markets/v2/calendar?start=2024-04-01&end=${protocol.period.end}`)
writeFileSync(root+'calendar.json',JSON.stringify(calendar))
const symbols=[...protocol.symbols,protocol.marketProxy];let cursor=0
await Promise.all(Array.from({length:2},async()=>{while(cursor<symbols.length){
 const symbol=symbols[cursor++]
 for(const timeframe of ['1Day','1Min']){
  const path=root+`${symbol}-${timeframe}.json`
  if(existsSync(path)){console.log(symbol,timeframe,'cached');continue}
  let page='',bars=[];const seen=new Set()
  do{
   const q=new URLSearchParams({symbols:symbol,timeframe,start:'2024-04-01T00:00:00Z',end:protocol.period.end+'T23:59:59Z',feed:protocol.feed,adjustment:protocol.adjustment,limit:'10000',sort:'asc',...(page?{page_token:page}:{})})
   const data=await get('https://data.alpaca.markets/v2/stocks/bars?'+q)
   if(!Array.isArray(data.bars?.[symbol]))throw new Error('Missing historical series for '+symbol)
   bars.push(...data.bars[symbol]);page=data.next_page_token??''
   if(page&&seen.has(page))throw new Error('Repeated historical page token')
   seen.add(page)
   if(seen.size>250)throw new Error('Historical pagination exceeded expected range')
  }while(page)
  writeFileSync(path+'.tmp',JSON.stringify(bars));renameSync(path+'.tmp',path)
  console.log(symbol,timeframe,bars.length)
 }
}}))
const files=symbols.flatMap(s=>['1Day','1Min'].map(t=>{const b=readFileSync(root+`${s}-${t}.json`);return {file:`${s}-${t}.json`,sha256:createHash('sha256').update(b).digest('hex')}}))
writeFileSync(root+'manifest.json',JSON.stringify({fetchedAt:new Date().toISOString(),feed:protocol.feed,adjustment:protocol.adjustment,period:protocol.period,files},null,2))
