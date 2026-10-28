import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
const root='.local-run/broad-strategy/',p=JSON.parse(readFileSync('services/strategy-research/broad-protocol.json','utf8')),eligible=JSON.parse(readFileSync(root+'eligible.json','utf8')),calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))).filter(s=>s.date>=p.period.start),byDate=new Map(calendar.map(s=>[s.date,{...s,symbols:[]}]))
mkdirSync(root+'raw-mornings',{recursive:true})
for(const stock of eligible.eligibleSymbols){const raw=JSON.parse(readFileSync(root+'raw-daily/'+stock.symbol+'.json','utf8')),adjusted=JSON.parse(readFileSync(root+'daily/'+stock.symbol+'.json','utf8')),a=new Map(adjusted.map(b=>[b.t.slice(0,10),b])),r=new Map(raw.map(b=>[b.t.slice(0,10),b]));for(const date of stock.dates){const original=r.get(date),scaled=a.get(date);if(original&&scaled&&Math.abs(original.o/scaled.o-1)>.00000001)byDate.get(date).symbols.push(stock.symbol)}}
const work=[...byDate.values()].filter(d=>d.symbols.length&&!existsSync(root+'raw-mornings/'+d.date+'.json')),read=await ownerMarketReader();let cursor=0,done=0
console.log('Split-affected sessions requiring raw morning prices',work.length)
await Promise.all(Array.from({length:8},async()=>{while(cursor<work.length){const day=work[cursor++],all=Object.fromEntries(day.symbols.map(s=>[s,[]]))
 for(let i=0;i<day.symbols.length;i+=450){const group=day.symbols.slice(i,i+450);let page='';const seen=new Set();do{const q=new URLSearchParams({symbols:group.join(','),timeframe:'15Min',start:new Date(day.utcOpen).toISOString(),end:new Date(day.utcOpen+90*60000-1).toISOString(),feed:p.feed,adjustment:'raw',limit:'10000',sort:'asc',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q);if(!data.bars)throw new Error('Raw morning prices unavailable');for(const [s,bars]of Object.entries(data.bars)){if(!all[s]||!Array.isArray(bars))throw new Error('Unexpected raw morning symbol');all[s].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated raw morning page');seen.add(page)}while(page)}
 const path=root+'raw-mornings/'+day.date+'.json';writeFileSync(path+'.tmp',JSON.stringify(all));renameSync(path+'.tmp',path);done++;if(done%20===0||done===work.length)console.log('Raw morning sessions',done,'/',work.length)
}}))
const files=[...byDate.values()].filter(d=>d.symbols.length).map(d=>{const file='raw-mornings/'+d.date+'.json';return {file,sha256:createHash('sha256').update(readFileSync(root+file)).digest('hex')}})
writeFileSync(root+'nominal-coarse-manifest.json',JSON.stringify({format:'raw-split-affected-mornings',feed:p.feed,adjustment:'raw',fetchedAt:new Date().toISOString(),files},null,2))
