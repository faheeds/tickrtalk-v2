import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'

const root='.local-run/evidence-strategy/',protocol=JSON.parse(readFileSync('services/strategy-research/evidence-protocol.json','utf8'))
const candidateBytes=readFileSync(root+'candidates.json','utf8'),index=JSON.parse(candidateBytes),candidatesHash=createHash('sha256').update(candidateBytes).digest('hex')
const calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8')))
const read=await ownerMarketReader(),dir=root+'executions/'
mkdirSync(dir,{recursive:true})
const days=calendar.filter(s=>s.date>=protocol.period.start&&s.date<=protocol.period.end).map(session=>({
 session,symbols:[...new Set((index.shortlists[session.date]??[]).filter(r=>r.direction==='long').map(r=>r.symbol))].sort()
})).filter(day=>day.symbols.length>0&&!existsSync(dir+day.session.date+'.json'))
let cursor=0,done=0
await Promise.all(Array.from({length:8},async()=>{
 while(cursor<days.length){
  const {session,symbols}=days[cursor++],all=Object.fromEntries(symbols.map(symbol=>[symbol,[]]))
  for(let i=0;i<symbols.length;i+=40){
   const group=symbols.slice(i,i+40);let page='';const seen=new Set()
   do{
    const query=new URLSearchParams({symbols:group.join(','),timeframe:'1Min',start:new Date(session.utcOpen).toISOString(),end:new Date(session.utcOpen+session.minutes*60000-1).toISOString(),feed:protocol.feed,adjustment:'raw',limit:'10000',sort:'asc',...(page?{page_token:page}:{})})
    const data=await read('https://data.alpaca.markets/v2/stocks/bars?'+query)
    if(!data.bars)throw new Error('Missing one-minute execution history for '+session.date)
    for(const [symbol,bars]of Object.entries(data.bars)){if(!all[symbol]||!Array.isArray(bars))throw new Error('Unexpected execution symbol for '+session.date);all[symbol].push(...bars)}
    page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated one-minute execution page');seen.add(page)
   }while(page)
  }
  for(const [symbol,bars]of Object.entries(all)){
   for(let i=1;i<bars.length;i++)if(Date.parse(bars[i].t)<=Date.parse(bars[i-1].t))throw new Error('Duplicate or unsorted execution bars for '+session.date+' '+symbol)
  }
  const file=dir+session.date+'.json';writeFileSync(file+'.tmp',JSON.stringify(all));renameSync(file+'.tmp',file)
  done++;if(done%25===0||done===days.length)console.log('ORB execution sessions',done,'/',days.length)
 }
}))
const files=calendar.filter(s=>s.date>=protocol.period.start&&s.date<=protocol.period.end).flatMap(session=>{
 const symbols=[...new Set((index.shortlists[session.date]??[]).filter(r=>r.direction==='long').map(r=>r.symbol))]
 return symbols.length?[{file:'executions/'+session.date+'.json',sha256:createHash('sha256').update(readFileSync(dir+session.date+'.json')).digest('hex')}]:[]
})
writeFileSync(root+'execution-manifest.json',JSON.stringify({fetchedAt:new Date().toISOString(),feed:protocol.feed,adjustment:'raw',candidatesProtocolHash:index.protocolHash,candidatesHash,files},null,2))
console.log('ORB execution collection complete',files.length,'sessions')
