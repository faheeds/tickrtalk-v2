import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {normalizeCalendar} from '../services/strategy-research/data.mjs'
import {openingStatistics,buildSymbolResearch,assignArms} from '../services/strategy-research/broad-signals.mjs'
import {sessionPriceFactor,nominalSession} from '../services/strategy-research/nominal-prices.mjs'
const root='.local-run/broad-strategy/',p=JSON.parse(readFileSync('services/strategy-research/broad-protocol.json','utf8')),eligible=JSON.parse(readFileSync(root+'eligible.json','utf8')),calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))),manifest=JSON.parse(readFileSync(root+'coarse-manifest.json','utf8'))
if(manifest.format!=='morning-sessions')throw new Error('Expected morning-session data format.')
const series=new Map()
for(const file of manifest.files){const bytes=readFileSync(root+file.file);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Morning history checksum mismatch');for(const [symbol,bars]of Object.entries(JSON.parse(bytes))){if(!series.has(symbol))series.set(symbol,[]);series.get(symbol).push(...bars)}}
const coarse=s=>series.get(s)??[]
const rawMorningManifest=JSON.parse(readFileSync(root+'nominal-coarse-manifest.json','utf8')),rawMorningByDate=new Map()
for(const file of rawMorningManifest.files){const bytes=readFileSync(root+file.file);if(createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error('Raw morning checksum mismatch');rawMorningByDate.set(file.file.slice('raw-mornings/'.length,-5),JSON.parse(bytes))}
if(eligible.priceEligibility!=='raw')throw new Error('Run the nominal-price eligibility audit first.')
const daily=(prefix,symbol)=>{const file=prefix+symbol+'.json',bytes=readFileSync(root+file);if(createHash('sha256').update(bytes).digest('hex')!==eligible.dailyFiles.find(f=>f.file===file)?.sha256)throw new Error('Daily price history checksum mismatch: '+symbol);return JSON.parse(bytes)}
const marketDaily=daily('daily/','SPY'),marketRaw=daily('raw-daily/','SPY'),adjustedMarket=new Map(marketDaily.map(b=>[b.t.slice(0,10),b])),rawMarket=new Map(marketRaw.map(b=>[b.t.slice(0,10),b])),marketFactors=new Map(),marketDays=openingStatistics(coarse('SPY'),calendar),snapshot=JSON.parse(readFileSync('services/paper/data/sp500.json','utf8')),sp500=new Set(snapshot.members.map(s=>s.symbol)),records=[],signals=[],priceAuditExclusions=[]
for(const [date,day]of marketDays)if(day.opening){const factor=sessionPriceFactor(adjustedMarket.get(date),rawMarket.get(date));marketFactors.set(date,factor);marketDays.set(date,nominalSession(day,factor))}
for(const stock of eligible.eligibleSymbols){const result=buildSymbolResearch({stock,daily:daily('daily/',stock.symbol),rawDaily:daily('raw-daily/',stock.symbol),coarse:coarse(stock.symbol),rawMorningByDate,calendar,marketDays,marketDaily,marketFactors,protocol:p,sp500});records.push(...result.records);signals.push(...result.signals);priceAuditExclusions.push(...result.auditExclusions)}
const arms=assignArms(records,signals,p),dates=Object.fromEntries(calendar.filter(d=>d.date>=p.period.start).map(d=>[d.date,{date:d.date,minutes:d.minutes,utcOpen:d.utcOpen,symbols:[...new Set(arms.signals.filter(s=>s.date===d.date).map(s=>s.symbol))]}]))
writeFileSync(root+'signals.json',JSON.stringify({builtAt:new Date().toISOString(),protocolHash:createHash('sha256').update(readFileSync('services/strategy-research/broad-protocol.json')).digest('hex'),signals:arms.signals,shortlists:arms.shortlists,sessions:Object.values(dates),stockCount:eligible.currentCatalogCount,eligibleCount:eligible.eligibleSymbols.length,sp500EligibleCount:eligible.eligibleSymbols.filter(s=>sp500.has(s.symbol)).length,survivorshipBias:true,priceAuditExclusions}))
console.log(JSON.stringify({signals:signals.length,candidateStockSessions:Object.values(dates).reduce((s,d)=>s+d.symbols.length,0),eligibleStocks:eligible.eligibleSymbols.length}))
