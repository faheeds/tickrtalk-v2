import type {PaperFill} from './types'
import {buildPerformance} from './performance.mjs'
export function samplePerformance(style:string,capital=1000){
  const started='2025-10-01T13:00:00Z',fills:PaperFill[]=[],observations:{day:string;value:number;observedAt:string}[]=[]
  const trades=[{symbol:'AAPL',entry:210,exit:216,closed:'2025-12-12'},{symbol:'MSFT',entry:320,exit:312,closed:'2026-03-12'},{symbol:'NVDA',entry:155,exit:167,closed:'2026-06-12'},{symbol:'AAPL',entry:225,exit:231,closed:'2026-10-12'}]
  let value=capital
  for(const [i,trade] of trades.entries()){
    const lag=style==='day'?0:style==='swing'?7:60,opened=new Date(Date.parse(trade.closed+'T14:00:00Z')-lag*86400000).toISOString(),closed=trade.closed+'T19:00:00Z',qty=Math.floor(Math.min(capital*.4,500)/trade.entry)
    if(!qty)continue
    fills.push({id:`sample-buy-${style}-${i}`,order_id:`sample-buy-${style}-${i}`,symbol:trade.symbol,style,side:'buy',qty,price:trade.entry,time:opened,version:'Illustrative example',source:'Sample data'})
    fills.push({id:`sample-sell-${style}-${i}`,order_id:`sample-sell-${style}-${i}`,symbol:trade.symbol,style,side:'sell',qty,price:trade.exit,time:closed,version:'Illustrative example',source:'Sample data'})
    // A sample mark is an illustration, never a claim about a real historical price.
    for(let day=opened.slice(0,10);day<trade.closed;day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10))observations.push({day,value,observedAt:day+'T20:00:00Z'})
    value+=qty*(trade.exit-trade.entry)
  }
  return buildPerformance({capital,started,fills,observations,now:'2026-10-14T20:00:00Z'})
}
