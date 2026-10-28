import {readFileSync,writeFileSync} from 'node:fs'
import {ownerMarketReader} from '../services/strategy-research/market-reader.mjs'
import {newsEvidence} from '../services/strategy-research/catalysts.mjs'
const root='.local-run/broad-strategy/',index=JSON.parse(readFileSync(root+'signals.json','utf8')),date=Object.keys(index.shortlists).sort().at(-1),stocks=index.shortlists[date],session=index.sessions.find(s=>s.date===date)
if(!session||!stocks?.length)throw new Error('No historical shortlist to enrich.')
const asOf=new Date(session.utcOpen+15*60000).toISOString(),start=new Date(Date.parse(asOf)-96*3600000).toISOString(),read=await ownerMarketReader(),items=[];let page='';const seen=new Set()
try{
 do{const q=new URLSearchParams({symbols:stocks.map(s=>s.symbol).join(','),start,end:asOf,limit:'50',sort:'asc',include_content:'false',...(page?{page_token:page}:{})}),data=await read('https://data.alpaca.markets/v1beta1/news?'+q)
  if(!Array.isArray(data.news))throw new Error('News response was incomplete.');items.push(...data.news);page=data.next_page_token??'';if(page&&seen.has(page))throw new Error('News pagination repeated.');seen.add(page);if(seen.size>40)throw new Error('News range exceeded the bounded import.')
 }while(page)
 const evidence=Object.fromEntries(stocks.map(s=>[s.symbol,newsEvidence(items,s.symbol,asOf)]));writeFileSync(root+'shortlist-news.json',JSON.stringify({status:'evidence_requires_review',date,asOf,evidence,historicalCoverage:'latest shortlist only; not a full-period catalyst filter'},null,2));console.log('Dated news evidence collected; no catalyst was automatically verified.')
}catch(error){writeFileSync(root+'shortlist-news.json',JSON.stringify({status:'unavailable',date,asOf,evidence:{},error:error instanceof Error?error.message:'News unavailable'},null,2));console.log('News enrichment unavailable. Catalyst verification remains blocked.')}
