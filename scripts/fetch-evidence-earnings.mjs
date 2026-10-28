import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync} from 'node:fs'
import dotenv from 'dotenv'
import {normalizeEarnings} from '../services/strategy-research/evidence-model.mjs'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
import {priorMetrics} from '../services/strategy-research/evidence-model.mjs'
const p=JSON.parse(readFileSync('services/strategy-research/evidence-protocol.json','utf8')),root='.local-run/evidence-strategy/',env=dotenv.parse(readFileSync('.env.hosted')),key=env.FMP_API_KEY
if(!key)throw new Error('Add FMP_API_KEY privately to .env.hosted before running earnings collection.')
mkdirSync(root+'earnings',{recursive:true});const stocks=JSON.parse(readFileSync('.local-run/broad-strategy/universe.json','utf8')).stocks,calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))),criteria={minimumPreviousClose:p.earnings.minimumPrice,minimumAverageDollarVolume:p.earnings.minimumAverageDollarVolume,lookback:p.earnings.volumeLookback}
let eligible
if(existsSync(root+'earnings-universe.json')){
 const saved=JSON.parse(readFileSync(root+'earnings-universe.json','utf8'))
 eligible=JSON.stringify(saved.criteria)===JSON.stringify(criteria)?stocks.filter(s=>saved.symbols.includes(s.symbol)):null
}
if(!eligible){
 eligible=[]
 for(const stock of stocks){
  const adjusted=JSON.parse(readFileSync(root+'daily-split/'+stock.symbol+'.json','utf8')),raw=JSON.parse(readFileSync(root+'daily-raw/'+stock.symbol+'.json','utf8'))
  let qualifies=false
  for(const session of calendar){
   if(session.date<p.period.start||session.date>p.period.end)continue
   try{const metric=priorMetrics(adjusted,raw,session.date,p.earnings.volumeLookback);if(metric&&metric.previousClose>=p.earnings.minimumPrice&&metric.averageDollarVolume>=p.earnings.minimumAverageDollarVolume){qualifies=true;break}}catch{}
  }
  if(qualifies)eligible.push(stock)
 }
 writeFileSync(root+'earnings-universe.json',JSON.stringify({createdAt:new Date().toISOString(),criteria,symbols:eligible.map(s=>s.symbol)}))
}
const missing=eligible.filter(s=>{
 const file=root+'earnings/'+s.symbol+'.json'
 if(!existsSync(file))return !(existsSync(root+'earnings/'+s.symbol+'.rejected.json')&&JSON.parse(readFileSync(root+'earnings/'+s.symbol+'.rejected.json','utf8')).status===402)
 const cached=JSON.parse(readFileSync(file,'utf8'))
 return cached.timingFieldRequested!==true&&cached.records.some(row=>!Object.hasOwn(row,'time'))
})
let cursor=0,previous=0,done=0,processed=0,stopped=false
const failures=[]
await Promise.all(Array.from({length:3},async()=>{while(cursor<missing.length&&!stopped){
 const stock=missing[cursor++],wait=Math.max(0,previous+350-Date.now());previous=Date.now()+wait;if(wait)await new Promise(r=>setTimeout(r,wait))
 try{
  const url=new URL('https://financialmodelingprep.com/stable/earnings');url.search=new URLSearchParams({symbol:stock.symbol,apikey:key,includeReportTimes:'true',limit:'1000'})
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)})
  if(!response.ok){failures.push({symbol:stock.symbol,status:response.status});if(response.status===402){writeFileSync(root+'earnings/'+stock.symbol+'.rejected.json',JSON.stringify({symbol:stock.symbol,status:402,records:[]}));processed++;continue}if([401,403,429].includes(response.status))stopped=true;continue}
  const payload=await response.json();if(!Array.isArray(payload))throw new Error('Unexpected earnings schema')
  const records=payload.filter(r=>r.date>=p.period.warmup&&r.date<=p.period.end).map(normalizeEarnings),keys=new Set()
  for(const row of records){if(row.symbol!==stock.symbol||keys.has(row.date))throw new Error('Mismatched or duplicate earnings row');keys.add(row.date)}
  const path=root+'earnings/'+stock.symbol+'.json';writeFileSync(path+'.tmp',JSON.stringify({symbol:stock.symbol,fetchedAt:new Date().toISOString(),records,timingFieldRequested:true,timingVerified:false,estimatePointInTimeVerified:false}));renameSync(path+'.tmp',path)
  done++;processed++;if(processed%100===0||processed===missing.length)console.log('Earnings histories',processed,'/',missing.length,'successful',done)
 }catch{failures.push({symbol:stock.symbol,status:'network_or_schema_error'});writeFileSync(root+'earnings/'+stock.symbol+'.rejected.json',JSON.stringify({symbol:stock.symbol,reason:'network_or_schema_error',records:[]}));processed++;if(processed%100===0||processed===missing.length)console.log('Earnings histories',processed,'/',missing.length,'successful',done)}
}}))
const dataSymbols=eligible.filter(s=>existsSync(root+'earnings/'+s.symbol+'.json')),rejected=eligible.filter(s=>existsSync(root+'earnings/'+s.symbol+'.rejected.json')),allFailures=rejected.map(s=>{const row=JSON.parse(readFileSync(root+'earnings/'+s.symbol+'.rejected.json','utf8'));return {symbol:s.symbol,status:row.status??row.reason??'unavailable'}}),covered=dataSymbols.length+rejected.length===eligible.length
writeFileSync(root+'earnings-access.json',JSON.stringify({checkedAt:new Date().toISOString(),provider:'FMP stable earnings',requestedSymbols:eligible.length,attempted:dataSymbols.length+rejected.length,attemptedThisRun:processed,cached:dataSymbols.length,rejected:rejected.length,covered,completeData:dataSymbols.length===eligible.length,failures:allFailures,timingFieldRequested:true,estimatePointInTimeVerified:false},null,2))
console.log('Earnings collection',stopped?'stopped on authentication or rate limit':covered?'attempted all historically eligible symbols':'incomplete','new histories',done,'failures',failures.length)
