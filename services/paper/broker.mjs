export const PAPER_URL = 'https://paper-api.alpaca.markets'
import {eastern} from './core.mjs'
const DATA_URL = 'https://data.alpaca.markets'
export class BrokerError extends Error { constructor(message,status) {super(message);this.status=status} }
export function paperBroker(credentials, fetcher=fetch) {
  if (!credentials?.key || !credentials?.secret) throw new BrokerError('Paper key and secret are required.',428)
  async function request(path,{method='GET',body,data=false,signal}={}) {
    const response=await fetcher((data?DATA_URL:PAPER_URL)+path,{method,headers:{'APCA-API-KEY-ID':credentials.key,'APCA-API-SECRET-KEY':credentials.secret,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})
    const payload=response.status===204?null:await response.json().catch(()=>null)
    if (!response.ok) throw new BrokerError(response.status===401||response.status===403?'Alpaca rejected the paper credentials or permissions.':response.status===429?'Alpaca rate-limited this request.':`Alpaca request failed (${response.status}).`,response.status)
    return payload
  }
  return {
    account:()=>request('/v2/account'),positions:()=>request('/v2/positions'),clock:()=>request('/v2/clock'),
    config:()=>request('/v2/account/configurations'),
    calendar:(start,end)=>request(`/v2/calendar?start=${start}&end=${end}`),
    orders:()=>request('/v2/orders?status=open&nested=true&limit=500'),
    order:id=>request(`/v2/orders/${encodeURIComponent(id)}?nested=true`),
    byClient:id=>request(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(id)}`),
    submit:body=>request('/v2/orders',{method:'POST',body}),cancel:id=>request(`/v2/orders/${encodeURIComponent(id)}`,{method:'DELETE'}),
    asset:symbol=>request(`/v2/assets/${encodeURIComponent(symbol)}`),
    assets:()=>request('/v2/assets?status=active&asset_class=us_equity'),
    quote:symbol=>request(`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest?feed=iex`,{data:true}),
    async barsMany(symbols,intraday,clock){
      const groups=[];for(let i=0;i<symbols.length;i+=50)groups.push(symbols.slice(i,i+50))
      const result=Object.fromEntries(symbols.map(s=>[s,[]])),deadline=AbortSignal.timeout(25000)
      const today=eastern(clock.timestamp).date,start=intraday?today+'T00:00:00Z':new Date(new Date(clock.timestamp)-500*86400000).toISOString().slice(0,10)
      let index=0
      await Promise.all(Array.from({length:Math.min(2,groups.length)},async()=>{
        while(index<groups.length){
          const group=groups[index++],seen=new Set();let page='',count=0
          do{
            deadline.throwIfAborted()
            const query=new URLSearchParams({symbols:group.join(','),timeframe:intraday?'1Min':'1Day',start,end:clock.timestamp,feed:'iex',adjustment:'all',limit:'10000',sort:'asc',...(page?{page_token:page}:{})})
            const payload=await request(`/v2/stocks/bars?${query}`,{data:true,signal:deadline})
            if(!payload?.bars||typeof payload.bars!=='object'||Array.isArray(payload.bars))throw new BrokerError('Batch market bars are unavailable.',503)
            for(const [symbol,bars] of Object.entries(payload.bars)){
              if(!group.includes(symbol)||!Array.isArray(bars))throw new BrokerError('Batch market data contains an unexpected symbol.',503)
              result[symbol].push(...bars);count+=bars.length
            }
            page=payload.next_page_token??''
            if(page&&seen.has(page))throw new BrokerError('Batch market pagination repeated.',503)
            seen.add(page)
            if(count>50000)throw new BrokerError('Batch market data exceeded the expected range.',503)
          }while(page)
        }
      }))
      return result
    },
    async bars(symbol,intraday,clock) {
      const today=eastern(clock.timestamp).date,start=intraday?today:new Date(new Date(clock.timestamp)-500*86400000).toISOString().slice(0,10)
      const values=[],seen=new Set();let page=''
      do {
        const query=new URLSearchParams({timeframe:intraday?'1Min':'1Day',start:intraday?today+'T00:00:00Z':start,end:clock.timestamp,feed:'iex',adjustment:'all',limit:'10000',sort:'asc',...(page?{page_token:page}:{})})
        const result=await request(`/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`,{data:true})
        if (!Array.isArray(result.bars)) throw new BrokerError('Market bars are unavailable.',503)
        values.push(...result.bars);page=result.next_page_token??''
        if (seen.has(page) && page) throw new BrokerError('Market data pagination repeated.',503)
        seen.add(page)
      } while(page && values.length<30000)
      if (page) throw new BrokerError('Market data was truncated.',503)
      return values
    },
  }
}
