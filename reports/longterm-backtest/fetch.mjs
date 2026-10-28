// Downloads daily bars for the long-term backtest and its benchmarks.
//
// Usage:
//   ALPACA_KEY=... ALPACA_SECRET=... node reports/longterm-backtest/fetch.mjs [--universe halal-approx|sp500] [--start 2016-01-01] [--end 2026-10-15] [--feed sip|iex]
//
// Credentials: ALPACA_KEY / ALPACA_SECRET (or APCA_API_KEY_ID / APCA_API_SECRET_KEY). Paper keys work; only
// the market-data API is called. Nothing is traded and no application state is read or changed.
//
// Data: Alpaca historical daily bars, adjustment=all (splits and dividends), paginated. Default feed is SIP
// (consolidated tape; the free plan serves its full history for bars older than 15 minutes). IEX, the feed
// the paper engine uses live, only reaches back to about 2020, which is too short for the phases in run.mjs.
// Output goes to .local-run/longterm/ (git-ignored). Delete those files to refetch with a different feed.
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {HALAL_SYMBOLS} from '../../lib/halal.ts'

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]]:[]).filter(Boolean))
const key=process.env.ALPACA_KEY??process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_SECRET??process.env.APCA_API_SECRET_KEY
if(!key||!secret)throw new Error('Set ALPACA_KEY and ALPACA_SECRET (paper keys are fine; only market data is requested).')
const universeMode=args.universe??'halal-approx',start=args.start??'2016-01-01',end=args.end??'2026-10-15',feed=args.feed??'sip'
const root='.local-run/longterm/';mkdirSync(root,{recursive:true})
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret}

async function get(url){
  for(let attempt=0;attempt<6;attempt++){
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(60000)})
    if(r.status===429||r.status>=500){await new Promise(res=>setTimeout(res,5000*(attempt+1)));continue}
    if(!r.ok)throw new Error(`Market data request ${r.status} for ${url}`)
    return r.json()
  }
  throw new Error('Market data request kept failing: '+url)
}

const snapshot=JSON.parse(readFileSync('services/paper/data/sp500.json','utf8'))
const sp500=snapshot.members.map(m=>m.symbol)
// "halal-approx" = current S&P 500 members that appear in the static certification list shipped in lib/halal.ts.
// That list is a convenience snapshot, not the AAOIFI service the engine uses in production, and it has not been
// re-screened. Treat the universe as approximate and unverified. The production gate decides what actually trades.
const halal=new Set(HALAL_SYMBOLS)
const universe=universeMode==='sp500'?sp500:sp500.filter(s=>halal.has(s))
if(!universe.length)throw new Error('Empty universe.')
const benchmarks=['SPUS','SPY']
const calendar=await get(`https://paper-api.alpaca.markets/v2/calendar?start=${start}&end=${end}`)

writeFileSync(root+'config.json',JSON.stringify({universeMode,universeAsOf:snapshot.retrievedAt,universeSource:snapshot.source,universe,benchmarks,start,end,calendar,fetchedAt:new Date().toISOString(),feed,adjustment:'all'},null,2))
console.log(JSON.stringify({universeMode,symbols:universe.length,benchmarks,start,end,feed,sessions:calendar.length}))

const symbols=[...universe,...benchmarks];let cursor=0
await Promise.all(Array.from({length:3},async()=>{
  while(cursor<symbols.length){
    const symbol=symbols[cursor++],path=`${root}${symbol}-1Day.json`
    if(existsSync(path)){console.log(symbol,'cached');continue}
    let page='',bars=[]
    do{
      const query=new URLSearchParams({timeframe:'1Day',start:start+'T00:00:00Z',end:end+'T23:59:59Z',feed,adjustment:'all',limit:'10000',sort:'asc',...(page?{page_token:page}:{})})
      const payload=await get(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`)
      bars.push(...(payload.bars??[]));page=payload.next_page_token??''
    }while(page)
    writeFileSync(path,JSON.stringify(bars))
    console.log(symbol,bars.length,'daily bars',bars.length?'from '+bars[0].t.slice(0,10):'')
  }
}))
console.log('done')
