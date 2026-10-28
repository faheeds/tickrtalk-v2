import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {createDecipheriv} from 'node:crypto'
import dotenv from 'dotenv'
import {cloudDatabase} from '../../lib/deployment/database.mjs'
const env=dotenv.parse(readFileSync('.env.hosted'))
const rows=await cloudDatabase(env)('paper_cloud_state?id=eq.1&select=body')
const tables=rows[0].body.tables,id=tables.settings[0].release_id
const release=tables.releases.find(r=>r.id===id)
const owner=env.OWNER_USER_IDS.split(',')[0].trim(),account=tables.accounts.find(a=>a.user===owner)
const [iv,tag,bytes]=account.credentials.split(':')
const cipher=createDecipheriv('aes-256-gcm',Buffer.from(env.PAPER_ENCRYPTION_KEY,'hex'),Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'))
const creds=JSON.parse(Buffer.concat([cipher.update(Buffer.from(bytes,'hex')),cipher.final()]).toString())
const headers={'APCA-API-KEY-ID':creds.key,'APCA-API-SECRET-KEY':creds.secret}
async function get(url){for(let attempt=0;attempt<5;attempt++){const r=await fetch(url,{headers,signal:AbortSignal.timeout(60000)});if(r.status===429||r.status>=500){await new Promise(r=>setTimeout(r,5000));continue}if(!r.ok)throw new Error('Market data request '+r.status);return r.json()}throw new Error('Market data retries exhausted')}
const clock=await get('https://paper-api.alpaca.markets/v2/clock')
const end='2026-10-15',start='2024-10-15'
const calendar=await get(`https://paper-api.alpaca.markets/v2/calendar?start=2024-04-01&end=${end}`)
const symbols=['AAPL','MSFT','NVDA','AMZN','GOOGL','META','JPM','XOM','JNJ','WMT']
const universe=JSON.parse(readFileSync('services/paper/data/sp500.json','utf8'))
writeFileSync('.local-run/backtest/config.json',JSON.stringify({releaseId:id,releaseCreated:release.created,config:JSON.parse(release.body),clock,start,end,symbols,calendar,universeAsOf:universe.asOf??null},null,2))
console.log(JSON.stringify({releaseId:id,releaseCreated:release.created,config:JSON.parse(release.body),clock,calendarSessions:calendar.length,symbols}))
let cursor=0
await Promise.all(Array.from({length:2},async()=>{while(cursor<symbols.length){const symbol=symbols[cursor++];for(const timeframe of ['1Day','1Min']){const path=`.local-run/backtest/${symbol}-${timeframe}.json`;if(existsSync(path)){console.log(symbol,timeframe,'cached');continue}let page='',bars=[],pages=0;do{const q=new URLSearchParams({symbols:symbol,timeframe,start:timeframe==='1Day'?'2024-04-01T00:00:00Z':start+'T00:00:00Z',end:end+'T23:59:59Z',feed:'iex',adjustment:'all',limit:'10000',sort:'asc',...(page?{page_token:page}:{})});const data=await get('https://data.alpaca.markets/v2/stocks/bars?'+q);bars.push(...(data.bars[symbol]??[]));page=data.next_page_token??'';pages++;if(pages>150)throw new Error('Pagination runaway');}while(page);writeFileSync(path,JSON.stringify(bars));console.log(symbol,timeframe,bars.length,bars[0]?.t,bars.at(-1)?.t)}}}))
