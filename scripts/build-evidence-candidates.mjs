import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
import {openingShortlist,validBar,earningsCandidate} from '../services/strategy-research/evidence-model.mjs'
import {sessionPriceFactor} from '../services/strategy-research/nominal-prices.mjs'
const p=JSON.parse(readFileSync('services/strategy-research/evidence-protocol.json','utf8')),root='.local-run/evidence-strategy/',calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))).filter(s=>s.date>='2021-09-01'),catalog=JSON.parse(readFileSync(root+'universe.json','utf8')).stocks,eligibility=JSON.parse(readFileSync(root+'opening-eligibility.json','utf8')),features=eligibility.byDate,shortlists={},histories=new Map(),factors=new Map(),exclusions={missingOpening:0,invalidOpening:0,scale:0,insufficientOpeningHistory:0},sourceFiles=new Set(['calendar.json','universe.json','opening-eligibility.json','scale-exclusions.jsonl','daily-manifest.json'])
// Opening volume is scaled into consistent split-adjusted share units, and the
// current observation is appended only after today's relative volume is fixed.
for(const stock of catalog){
 const adjusted=JSON.parse(readFileSync(root+'daily-split/'+stock.symbol+'.json','utf8')),raw=JSON.parse(readFileSync(root+'daily-raw/'+stock.symbol+'.json','utf8')),lookup=new Map(raw.map(b=>[b.t.slice(0,10),b])),map=new Map()
 for(const b of adjusted){const r=lookup.get(b.t.slice(0,10));if(!r)continue;try{map.set(b.t.slice(0,10),sessionPriceFactor(b,r))}catch{}}
 factors.set(stock.symbol,map)
}
for(const session of calendar){
 const file='openings/'+session.date+'.json';if(!existsSync(root+file))throw new Error('Opening collection incomplete: '+session.date);sourceFiles.add(file)
 const data=JSON.parse(readFileSync(root+file,'utf8')),records=[]
 for(const r of features[session.date]){
  const bars=data[r.symbol]??[],opening=bars.find(b=>Date.parse(b.t)===session.utcOpen)
  if(!opening){exclusions.missingOpening++;continue}if(!validBar(opening)||bars.filter(b=>Date.parse(b.t)===session.utcOpen).length!==1){exclusions.invalidOpening++;continue}
  const previous=(histories.get(r.symbol)??[]).filter(x=>x.date<session.date).slice(-p.orb.lookback)
  // Missing sessions are not silently replaced by older observations.
  const expected=calendar.slice(Math.max(0,calendar.indexOf(session)-p.orb.lookback),calendar.indexOf(session)).map(s=>s.date)
  if(previous.length!==p.orb.lookback||previous.some((b,i)=>b.date!==expected[i])){exclusions.insufficientOpeningHistory++;continue}
  const typical=previous.reduce((s,b)=>s+b.volume,0)/previous.length,relativeVolume=opening.v*r.factor/typical
  if(!Number.isFinite(relativeVolume))throw new Error('Invalid relative volume')
  records.push({...r,date:session.date,open:opening.o,close:opening.c,high:opening.h,low:opening.l,relativeVolume})
 }
 if(session.date>=p.period.start)shortlists[session.date]=openingShortlist(records,p)
 for(const [symbol,bars]of Object.entries(data)){
  const b=bars.find(b=>Date.parse(b.t)===session.utcOpen),factor=factors.get(symbol)?.get(session.date)
  if(!validBar(b)||!factor){if(b&&!factor)exclusions.scale++;continue}
  const h=histories.get(symbol)??[];h.push({date:session.date,volume:b.v*factor});if(h.length>p.orb.lookback)h.shift();histories.set(symbol,h)
 }
}
const earnings=[],earningsExclusions=[],earningsFiles=[]
const calendarAccessFile=root+'earnings-calendar-access.json'
const calendarAccess=existsSync(calendarAccessFile)?JSON.parse(readFileSync(calendarAccessFile,'utf8')):null
const earningsAccess=calendarAccess??(existsSync(root+'earnings-access.json')?JSON.parse(readFileSync(root+'earnings-access.json','utf8')):{complete:false,cached:0})
for(const file of ['earnings-access.json','earnings-universe.json'])if(existsSync(root+file))sourceFiles.add(file)
if(calendarAccess)sourceFiles.add('earnings-calendar-access.json')
for(const stock of catalog){
 const calendarFile='earnings-calendar/'+stock.symbol+'.json',legacyFile='earnings/'+stock.symbol+'.json',file=existsSync(root+calendarFile)?calendarFile:legacyFile;if(!existsSync(root+file))continue;earningsFiles.push(file)
 const data=JSON.parse(readFileSync(root+file,'utf8')),daily=JSON.parse(readFileSync(root+'daily-split/'+stock.symbol+'.json','utf8')),rawDaily=JSON.parse(readFileSync(root+'daily-raw/'+stock.symbol+'.json','utf8'))
 for(const event of data.records.filter(e=>e.date>=p.period.start&&e.date<=p.period.end))try{const candidate=earningsCandidate(event,{sessions:calendar,daily,rawDaily},p);if(candidate)earnings.push(candidate)}catch(error){earningsExclusions.push({symbol:stock.symbol,date:event.date,reason:error.message})}
}
const hash=file=>createHash('sha256').update(readFileSync(root+file)).digest('hex'),sourceHashes=[...sourceFiles,...earningsFiles].sort().map(file=>({file,sha256:hash(file)}))
writeFileSync(root+'candidates.json',JSON.stringify({createdAt:new Date().toISOString(),protocolHash:createHash('sha256').update(readFileSync('services/strategy-research/evidence-protocol.json')).digest('hex'),shortlists,exclusions,earnings,earningsExclusions,earningsAccess,sourceHashes}));console.log('Candidate sessions',Object.keys(shortlists).length,'ORB long candidates',Object.values(shortlists).flat().filter(s=>s.direction==='long').length,'earnings candidates',earnings.length)
