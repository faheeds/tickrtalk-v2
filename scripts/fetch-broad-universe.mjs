import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {parseDirectory,commonStockUniverse,priorEligibility} from '../services/strategy-research/universe-scanner.mjs'
const protocol=JSON.parse(readFileSync('services/strategy-research/broad-protocol.json','utf8')),root='.local-run/broad-strategy/';mkdirSync(root+'daily',{recursive:true})
const read=await ownerMarketReader(),source='https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt'
let assets,directory
if(existsSync(root+'listings.json'))({assets,directory}=JSON.parse(readFileSync(root+'listings.json','utf8')))
else{const response=await fetch(source,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Nasdaq directory unavailable');directory=parseDirectory(await response.text());assets=await read('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity');writeFileSync(root+'listings.json',JSON.stringify({assets,directory,source,retrievedAt:new Date().toISOString()}))}
const universe=commonStockUniverse(directory,assets);if(universe.length<1000)throw new Error('Common-stock catalog unexpectedly incomplete: '+universe.length)
writeFileSync(root+'universe.json',JSON.stringify({retrievedAt:new Date().toISOString(),source,stocks:universe,survivorshipBias:true},null,2));console.log('Common-stock catalog',universe.length)
const calendar=await read(`https://paper-api.alpaca.markets/v2/calendar?start=${protocol.period.warmup}&end=${protocol.period.end}`);writeFileSync(root+'calendar.json',JSON.stringify(calendar))
const missing=universe.filter(s=>!existsSync(root+'daily/'+s.symbol+'.json')).map(s=>s.symbol)
for(let i=0;i<missing.length;i+=50){
 const group=missing.slice(i,i+50),all=Object.fromEntries(group.map(s=>[s,[]]));let page='';const seen=new Set()
 do{const q=new URLSearchParams({symbols:group.join(','),timeframe:'1Day',start:protocol.period.warmup,end:protocol.period.end+'T23:59:59Z',feed:protocol.feed,adjustment:protocol.adjustment,limit:'10000',sort:'asc',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q)
  if(!data.bars||typeof data.bars!=='object')throw new Error('Daily bars unavailable');for(const [symbol,bars]of Object.entries(data.bars)){if(!all[symbol]||!Array.isArray(bars))throw new Error('Unexpected historical symbol');all[symbol].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated market-data page');seen.add(page)
 }while(page)
 for(const [s,bars]of Object.entries(all)){const path=root+'daily/'+s+'.json';writeFileSync(path+'.tmp',JSON.stringify(bars));renameSync(path+'.tmp',path)}
 console.log('Daily history',Math.min(i+50,missing.length),'/',missing.length)
}
const sessions=calendar.filter(d=>d.date>=protocol.period.start),eligible=[],dailyCounts=Object.fromEntries(sessions.map(s=>[s.date,0]))
if(!existsSync(root+'daily/SPY.json')){const q=new URLSearchParams({symbols:'SPY',timeframe:'1Day',start:protocol.period.warmup,end:protocol.period.end+'T23:59:59Z',feed:protocol.feed,adjustment:protocol.adjustment,limit:'10000'}),payload=await read('https://data.alpaca.markets/v2/stocks/bars?'+q);if(!Array.isArray(payload.bars?.SPY)||payload.next_page_token)throw new Error('Market proxy daily history is incomplete');writeFileSync(root+'daily/SPY.json',JSON.stringify(payload.bars.SPY))}
for(const stock of universe){const bars=JSON.parse(readFileSync(root+'daily/'+stock.symbol+'.json','utf8')),dates=sessions.filter(s=>priorEligibility(bars,s.date,protocol.eligibility).eligible).map(s=>s.date);for(const date of dates)dailyCounts[date]++;if(dates.length)eligible.push({...stock,dates})}
const dailyFiles=[...universe.map(s=>s.symbol),'SPY'].map(symbol=>({file:'daily/'+symbol+'.json',sha256:createHash('sha256').update(readFileSync(root+'daily/'+symbol+'.json')).digest('hex')}))
const manifest={createdAt:new Date().toISOString(),protocolHash:createHash('sha256').update(readFileSync('services/strategy-research/broad-protocol.json')).digest('hex'),currentCatalogCount:universe.length,eligibleSymbols:eligible,dailyCounts,dailyFiles,survivorshipBias:true}
writeFileSync(root+'eligible.json',JSON.stringify(manifest));console.log('Symbols meeting prior-session liquidity/price filters on at least one research date:',eligible.length)
