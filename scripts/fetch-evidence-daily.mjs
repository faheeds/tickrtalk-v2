import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
const p=JSON.parse(readFileSync('services/strategy-research/evidence-protocol.json','utf8')),root='.local-run/evidence-strategy/',catalog=JSON.parse(readFileSync('.local-run/broad-strategy/universe.json','utf8'))
mkdirSync(root,{recursive:true});const read=await ownerMarketReader()
if(!existsSync(root+'calendar.json'))writeFileSync(root+'calendar.json',JSON.stringify(await read('https://paper-api.alpaca.markets/v2/calendar?'+new URLSearchParams({start:p.period.warmup,end:p.period.end}))))
if(!existsSync(root+'universe.json'))writeFileSync(root+'universe.json',JSON.stringify(catalog))
const stocks=JSON.parse(readFileSync(root+'universe.json','utf8')).stocks
for(const adjustment of ['split','raw']){
 const dir=root+'daily-'+adjustment+'/';mkdirSync(dir,{recursive:true})
 const missing=stocks.map(s=>s.symbol).filter(s=>!existsSync(dir+s+'.json'));let cursor=0,done=0
 await Promise.all(Array.from({length:4},async()=>{while(cursor<missing.length){
  const group=missing.slice(cursor,cursor+20);cursor+=20;const all=Object.fromEntries(group.map(s=>[s,[]]));let page='';const seen=new Set()
  do{const q=new URLSearchParams({symbols:group.join(','),timeframe:'1Day',start:p.period.warmup,end:p.period.end+'T23:59:59Z',feed:p.feed,adjustment,sort:'asc',limit:'10000',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q)
   if(!data.bars||typeof data.bars!=='object')throw new Error('Daily history unavailable')
   for(const [s,bars]of Object.entries(data.bars)){if(!all[s]||!Array.isArray(bars))throw new Error('Unexpected daily series');all[s].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated daily page');seen.add(page)
  }while(page)
  for(const [s,bars]of Object.entries(all)){for(let i=1;i<bars.length;i++)if(Date.parse(bars[i].t)<=Date.parse(bars[i-1].t))throw new Error('Unsorted daily history');writeFileSync(dir+s+'.json.tmp',JSON.stringify(bars));renameSync(dir+s+'.json.tmp',dir+s+'.json')}
  done+=group.length;if(done%200<20||done===missing.length)console.log('Daily',adjustment,done,'/',missing.length)
 }}))
}
const files=stocks.flatMap(s=>['split','raw'].map(a=>{const file='daily-'+a+'/'+s.symbol+'.json';return {file,sha256:createHash('sha256').update(readFileSync(root+file)).digest('hex')}}))
writeFileSync(root+'daily-manifest.json',JSON.stringify({createdAt:new Date().toISOString(),period:p.period,feed:p.feed,files}));console.log('Five-year daily collection complete',stocks.length)
