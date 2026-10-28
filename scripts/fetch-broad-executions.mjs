import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {signalFingerprint} from '../services/strategy-research/broad-data-hashes.mjs'
const root='.local-run/broad-strategy/',p=JSON.parse(readFileSync('services/strategy-research/broad-protocol.json','utf8')),index=JSON.parse(readFileSync(root+'signals.json','utf8')),read=await ownerMarketReader()
mkdirSync(root+'execution',{recursive:true});let cursor=0,done=0
const days=index.sessions.filter(d=>d.symbols.length&&!existsSync(root+'execution/'+d.date+'.json'))
await Promise.all(Array.from({length:8},async()=>{while(cursor<days.length){const day=days[cursor++],all=Object.fromEntries(day.symbols.map(s=>[s,[]]))
 for(let i=0;i<day.symbols.length;i+=40){const group=day.symbols.slice(i,i+40);let page='';const seen=new Set()
  do{const q=new URLSearchParams({symbols:group.join(','),timeframe:'1Min',start:new Date(day.utcOpen).toISOString(),end:new Date(day.utcOpen+day.minutes*60000-1).toISOString(),feed:p.feed,adjustment:p.executionAdjustment,limit:'10000',sort:'asc',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q)
   if(!data.bars)throw new Error('Missing execution history');for(const [s,bars]of Object.entries(data.bars)){if(!all[s]||!Array.isArray(bars))throw new Error('Unexpected execution symbol');all[s].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated minute page');seen.add(page)
  }while(page)
 }
 for(const [s,bars]of Object.entries(all)){if(!bars.length)throw new Error('No execution bars: '+day.date+' '+s);for(let i=1;i<bars.length;i++)if(Date.parse(bars[i].t)<=Date.parse(bars[i-1].t))throw new Error('Duplicate or unsorted execution bars')}
 const path=root+'execution/'+day.date+'.json';writeFileSync(path+'.tmp',JSON.stringify(all));renameSync(path+'.tmp',path);done++;if(done%10===0||done===days.length)console.log('Execution sessions',done,'/',days.length)
}}))
const files=index.sessions.filter(d=>d.symbols.length).map(d=>{const file='execution/'+d.date+'.json';return {file,sha256:createHash('sha256').update(readFileSync(root+file)).digest('hex')}})
writeFileSync(root+'execution-manifest.json',JSON.stringify({fetchedAt:new Date().toISOString(),feed:p.feed,adjustment:p.executionAdjustment,signalHash:signalFingerprint(index),files},null,2))
