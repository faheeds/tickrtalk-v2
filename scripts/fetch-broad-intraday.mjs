import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
const p=JSON.parse(readFileSync('services/strategy-research/broad-protocol.json','utf8')),root='.local-run/broad-strategy/',eligible=JSON.parse(readFileSync(root+'eligible.json','utf8')),calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))).filter(s=>s.date>=p.intradayWarmup)
mkdirSync(root+'mornings',{recursive:true});const read=await ownerMarketReader(),pointers=new Map(eligible.eligibleSymbols.map(s=>[s.symbol,0]))
// Future eligibility only identifies data-acquisition warmup windows, never trade eligibility.
const work=calendar.map(session=>{
 const symbols=[]
 for(const stock of eligible.eligibleSymbols){let i=pointers.get(stock.symbol);while(i<stock.dates.length&&stock.dates[i]<session.date)i++;pointers.set(stock.symbol,i);if(i<stock.dates.length&&Date.parse(stock.dates[i])-Date.parse(session.date)<=45*86400000)symbols.push(stock.symbol)}
 const wanted=[...symbols,'SPY'],path=root+'mornings/'+session.date+'.json',present=existsSync(path)?new Set(Object.keys(JSON.parse(readFileSync(path,'utf8')))):new Set()
 return {...session,symbols:wanted.filter(symbol=>!present.has(symbol))}
}).filter(s=>s.symbols.length)
let cursor=0,done=0
await Promise.all(Array.from({length:8},async()=>{while(cursor<work.length){
 const session=work[cursor++],all=Object.fromEntries(session.symbols.map(s=>[s,[]]))
 for(let i=0;i<session.symbols.length;i+=450){const group=session.symbols.slice(i,i+450);let page='';const seen=new Set()
  do{const q=new URLSearchParams({symbols:group.join(','),timeframe:'15Min',start:new Date(session.utcOpen).toISOString(),end:new Date(session.utcOpen+90*60000-1).toISOString(),feed:p.feed,adjustment:p.adjustment,limit:'10000',sort:'asc',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q)
   if(!data.bars)throw new Error('Missing morning series');for(const [s,bars]of Object.entries(data.bars)){if(!all[s]||!Array.isArray(bars))throw new Error('Unexpected morning symbol');all[s].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated morning-data page');seen.add(page)
  }while(page)
 }
 const path=root+'mornings/'+session.date+'.json',previous=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};writeFileSync(path+'.tmp',JSON.stringify({...previous,...all}));renameSync(path+'.tmp',path);done++;if(done%10===0||done===work.length)console.log('Morning scan sessions',done,'/',work.length)
}}))
const files=calendar.map(s=>{const file='mornings/'+s.date+'.json';return {file,sha256:createHash('sha256').update(readFileSync(root+file)).digest('hex')}})
writeFileSync(root+'coarse-manifest.json',JSON.stringify({format:'morning-sessions',fetchedAt:new Date().toISOString(),feed:p.feed,adjustment:p.adjustment,files},null,2))
