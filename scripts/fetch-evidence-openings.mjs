import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,appendFileSync} from 'node:fs'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
import {priorMetrics} from '../services/strategy-research/evidence-model.mjs'
const p=JSON.parse(readFileSync('services/strategy-research/evidence-protocol.json','utf8')),root='.local-run/evidence-strategy/'
if(!existsSync(root+'daily-manifest.json'))throw new Error('Complete the five-year daily collection first.')
const calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))),stocks=JSON.parse(readFileSync(root+'universe.json','utf8')).stocks
mkdirSync(root+'openings',{recursive:true})
if(!existsSync(root+'opening-eligibility.json')){
 const byDate=Object.fromEntries(calendar.map(s=>[s.date,[]]));let count=0,exclusions=0
 writeFileSync(root+'scale-exclusions.jsonl','')
 for(const stock of stocks){
  const adjusted=JSON.parse(readFileSync(root+'daily-split/'+stock.symbol+'.json','utf8')),raw=JSON.parse(readFileSync(root+'daily-raw/'+stock.symbol+'.json','utf8'))
  for(const session of calendar){
   try{const m=priorMetrics(adjusted,raw,session.date,p.orb.lookback);if(m&&m.averageVolume>=p.orb.minimumAverageVolume&&m.atr>p.orb.minimumAtrExclusive)byDate[session.date].push({symbol:stock.symbol,...m})}
   catch(error){exclusions++;appendFileSync(root+'scale-exclusions.jsonl',JSON.stringify({symbol:stock.symbol,date:session.date,reason:error.message})+'\n')}
  }
  count++;if(count%500===0)console.log('Opening eligibility prepared',count,'/',stocks.length)
 }
 writeFileSync(root+'opening-eligibility.json',JSON.stringify({byDate,exclusions}));console.log('Corporate-action exclusions',exclusions)
}
const eligibility=JSON.parse(readFileSync(root+'opening-eligibility.json','utf8')).byDate
// Warmup acquisition may include future eligible names, but ranking always uses
// only this session's recorded prior-session eligibility.
const wanted=Object.fromEntries(calendar.map(s=>[s.date,new Set()]))
for(let i=0;i<calendar.length;i++)for(const r of eligibility[calendar[i].date])for(let j=Math.max(0,i-20);j<=i;j++)wanted[calendar[j].date].add(r.symbol)
const work=calendar.filter(s=>s.date>='2021-09-01'&&!existsSync(root+'openings/'+s.date+'.json')),read=await ownerMarketReader();let cursor=0,done=0
await Promise.all(Array.from({length:6},async()=>{while(cursor<work.length){
 const session=work[cursor++],symbols=[...wanted[session.date]].sort(),all=Object.fromEntries(symbols.map(s=>[s,[]]))
 for(let i=0;i<symbols.length;i+=400){let page='';const seen=new Set(),group=symbols.slice(i,i+400)
  do{const q=new URLSearchParams({symbols:group.join(','),timeframe:'5Min',start:new Date(session.utcOpen).toISOString(),end:new Date(session.utcOpen+5*60000-1).toISOString(),feed:p.feed,adjustment:'raw',sort:'asc',limit:'10000',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v2/stocks/bars?'+q)
   if(!data.bars)throw new Error('Opening history unavailable');for(const [s,bars]of Object.entries(data.bars)){if(!all[s]||!Array.isArray(bars))throw new Error('Unexpected opening series');all[s].push(...bars)}page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('Repeated opening page');seen.add(page)
  }while(page)
 }
 const path=root+'openings/'+session.date+'.json';writeFileSync(path+'.tmp',JSON.stringify(all));renameSync(path+'.tmp',path);done++;if(done%50===0||done===work.length)console.log('Five-minute opening sessions',done,'/',work.length)
}}))
console.log('Opening collection complete')
