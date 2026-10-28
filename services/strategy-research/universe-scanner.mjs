const EXCLUDED=/\b(preferred|depositary|depository|warrant|rights|units?|notes?|bonds?|debentures?|ETF|ETN|fund|acquisition corp)\b/i
const COMMON=/\b(common stock|common shares|ordinary shares|capital stock|class [a-z] stock)\b/i
export function parseDirectory(text){
 const lines=text.trim().split(/\r?\n/),headers=lines.shift().split('|')
 if(!['Symbol','Security Name','Listing Exchange','ETF','Test Issue'].every(key=>headers.includes(key)))throw new Error('Nasdaq directory schema changed.')
 return lines.filter(line=>!line.startsWith('File Creation Time')).map(line=>Object.fromEntries(line.split('|').map((value,i)=>[headers[i],value])))
}
export function commonStockUniverse(directory,assets){
 const active=new Map(assets.filter(a=>a.class==='us_equity'&&a.status==='active'&&a.tradable&&['NYSE','NASDAQ'].includes(a.exchange)).map(a=>[a.symbol,a]))
 return directory.filter(row=>row.ETF==='N'&&row['Test Issue']==='N'&&['Q','N'].includes(row['Listing Exchange'])&&/^[A-Z][A-Z.]{0,9}$/.test(row.Symbol)&&COMMON.test(row['Security Name'])&&!EXCLUDED.test(row['Security Name'])&&active.has(row.Symbol)).map(row=>({symbol:row.Symbol,name:row['Security Name'],exchange:active.get(row.Symbol).exchange,classification:'directory-common-stock-heuristic'})).sort((a,b)=>a.symbol.localeCompare(b.symbol))
}
export function priorEligibility(bars,date,rules){
 const count=priorBarCount(bars,date)
 if(count<rules.minimumPriorSessions)return {eligible:false,reason:'insufficient_history'}
 const last=bars[count-1],recent=bars.slice(Math.max(0,count-rules.liquidityLookback),count)
 if(recent.length!==rules.liquidityLookback||recent.some(b=>![b.c,b.v].every(Number.isFinite)||b.c<=0||b.v<0))return {eligible:false,reason:'invalid_liquidity_data'}
 const lastDate=last.t.slice(0,10)
 if(Date.parse(date)-Date.parse(lastDate)>7*86400000)return {eligible:false,reason:'stale_history'}
 const averageDollarVolume=recent.reduce((s,b)=>s+b.c*b.v,0)/recent.length
 return {eligible:last.c>=rules.minimumPrice&&averageDollarVolume>=rules.minimumAverageDollarVolume,previousClose:last.c,averageDollarVolume,asOf:lastDate}
}
export function priorBarCount(bars,date){let low=0,high=bars.length;while(low<high){const middle=(low+high)>>>1;if(bars[middle].t.slice(0,10)<date)low=middle+1;else high=middle}return low}
export function openingRecord(bars,session){
 const found=bars.find(b=>Date.parse(b.t)===session.utcOpen)
 if(!found||![found.o,found.h,found.l,found.c,found.v].every(Number.isFinite)||found.o<=0||found.c<=0||found.v<=0)return null
 return found
}
export function shortlist(rows,scanner){
 return rows.filter(r=>r.eligible&&r.relativeVolume>=scanner.minimumRelativeVolume&&Math.abs(r.gapPct)>=scanner.minimumAbsoluteGapPct&&Math.abs(r.gapPct)<=scanner.maximumAbsoluteGapPct).map(r=>({...r,score:r.relativeVolume*(1+Math.abs(r.gapPct)/100)})).sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol)).slice(0,scanner.shortlistSize)
}
export function activationAssessment({quote,now,screening,catalyst,availableCash,orderNotional,realtimeFeedVerified,universeAuditVerified,prospectiveValidationVerified}){
 const reasons=[],age=(Date.parse(now)-Date.parse(quote?.t))/1000
 if(!quote||![quote.bp,quote.ap].every(Number.isFinite)||quote.bp<=0||quote.ap<quote.bp||!Number.isFinite(age)||age<0||age>30)reasons.push('fresh_quote_required')
 else if((quote.ap-quote.bp)/quote.ap*100>.1)reasons.push('spread_too_wide')
 if(Number.isFinite(quote?.ap)&&quote.ap<10)reasons.push('minimum_price_required')
 if(!screening||screening.status!=='halal'||!screening.fullyVerified||!Number.isFinite(Date.parse(screening.assessedAt))||Date.parse(now)-Date.parse(screening.assessedAt)<0||Date.parse(now)-Date.parse(screening.assessedAt)>86400000)reasons.push('verified_aaoifi_pass_required')
 if(!catalyst?.verified||!Number.isFinite(Date.parse(catalyst.publishedAt))||Date.parse(catalyst.publishedAt)>Date.parse(now)||Date.parse(now)-Date.parse(catalyst.publishedAt)>96*3600000)reasons.push('verified_catalyst_required')
 if(!Number.isFinite(availableCash)||!Number.isFinite(orderNotional)||orderNotional<=0||availableCash<orderNotional)reasons.push('verified_cash_required')
 if(!realtimeFeedVerified)reasons.push('realtime_feed_verification_required')
 if(!universeAuditVerified)reasons.push('historical_universe_audit_required')
 if(!prospectiveValidationVerified)reasons.push('prospective_paper_validation_required')
 return {eligible:reasons.length===0,reasons,executionEnabled:false}
}
