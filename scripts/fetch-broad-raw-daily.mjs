import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {priorEligibility} from '../services/strategy-research/universe-scanner.mjs'
const root='.local-run/broad-strategy/',p=JSON.parse(readFileSync('services/strategy-research/broad-protocol.json','utf8')),catalog=JSON.parse(readFileSync(root+'universe.json','utf8')),calendar=JSON.parse(readFileSync(root+'calendar.json','utf8')),sessions=calendar.filter(s=>s.date>=p.period.start),pool=[]
mkdirSync(root+'raw-daily',{recursive:true})
for(const stock of catalog.stocks){const bars=JSON.parse(readFileSync(root+'daily/'+stock.symbol+'.json','utf8'));if(sessions.some(s=>priorEligibility(bars,s.date,{...p.eligibility,minimumPrice:0}).eligible))pool.push(stock)}
const missing=[...pool.map(s=>s.symbol),'SPY'].filter(s=>!existsSync(root+'raw-daily/'+s+'.json')),read=await ownerMarketReader();console.log('Raw-price audit pool',pool.length)
for(let i=0;i<missing.length;i+=50){const group=missing.slice(i,i+50),all=Object.fromEntries(group.map(s=>[s,[]]));let page='';const seen=new Set()
 do{await new Promise(r=>setTimeout(r,2000));const q=new URLSearchParams({symbols:group.join(','),timeframe:'1Day',start:p.period.warmup,end:p.period.end+'T23:59:59Z',feed:p.feed,adjustment:'raw',sort:'asc',limit:'10000',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q)
  if(!data.bars)throw new Error('Raw daily history unavailable');for(const [s,bars]of Object.entries(data.bars)){if(!all[s]||!Array.isArray(bars))throw new Error('Unexpected raw-price symbol');all[s].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated raw-price page');seen.add(page)
 }while(page)
 for(const [s,bars]of Object.entries(all)){const path=root+'raw-daily/'+s+'.json';writeFileSync(path+'.tmp',JSON.stringify(bars));renameSync(path+'.tmp',path)}console.log('Raw daily history',Math.min(i+50,missing.length),'/',missing.length)
}
const eligible=[],dailyCounts=Object.fromEntries(sessions.map(s=>[s.date,0]))
for(const stock of pool){const bars=JSON.parse(readFileSync(root+'raw-daily/'+stock.symbol+'.json','utf8')),dates=sessions.filter(s=>priorEligibility(bars,s.date,p.eligibility).eligible).map(s=>s.date);for(const date of dates)dailyCounts[date]++;if(dates.length)eligible.push({...stock,dates})}
const symbols=[...pool.map(s=>s.symbol),'SPY'],dailyFiles=symbols.flatMap(s=>['daily/','raw-daily/'].map(prefix=>({file:prefix+s+'.json',sha256:createHash('sha256').update(readFileSync(root+prefix+s+'.json')).digest('hex')})))
writeFileSync(root+'eligible.json',JSON.stringify({createdAt:new Date().toISOString(),protocolHash:createHash('sha256').update(readFileSync('services/strategy-research/broad-protocol.json')).digest('hex'),currentCatalogCount:catalog.stocks.length,eligibleSymbols:eligible,dailyCounts,dailyFiles,survivorshipBias:true,priceEligibility:'raw'}));console.log('Nominal-price eligible symbols',eligible.length)
