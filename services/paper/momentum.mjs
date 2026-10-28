// Cross-sectional 12-1 momentum: the one ranking implementation shared by the research harness
// (reports/momentum-backtest) and the paper service, so what was backtested is what runs.
//
// Rule: on the first session of each month, rank eligible symbols by close[t-skip] / close[t-lookback] - 1 using
// completed daily bars through the previous session, hold the top N equal weight, sell drop-outs at the rebalance
// open, buy entrants at the next open from settled cash, leave holdovers alone. No stops, no targets.
export const MOMENTUM_DEFAULTS=Object.freeze({lookback:252,skip:21,topN:20,sectorMax:null,rankBy:'raw',volWindow:126})

/** Score at bar index i (the rebalance session; bars[i-1] is the last completed bar). */
export function momentumScore(bars,i,lookback=MOMENTUM_DEFAULTS.lookback,skip=MOMENTUM_DEFAULTS.skip){
  if(i<lookback)return null
  const recent=bars[i-skip]?.close,old=bars[i-lookback]?.close
  return recent>0&&old>0?recent/old-1:null
}

/** Annualized volatility of daily close-to-close returns over the `window` sessions ending at bar i-1. */
export function trailingVol(bars,i,window=63){
  if(i-window-1<0)return null
  let sum=0,sum2=0,n=0
  for(let k=i-window;k<i;k++){const r=bars[k].close/bars[k-1].close-1;sum+=r;sum2+=r*r;n++}
  const mean=sum/n,variance=sum2/n-mean*mean
  return variance>0?Math.sqrt(variance*252):null
}

/**
 * Rank a universe. `bars` maps symbol → completed daily bars (oldest first, each with `close`); the score is taken at
 * the end of each series. `sectorOf(symbol)` and `sectorMax` cap names per sector; `rankBy: 'riskAdjusted'` divides
 * the score by trailing volatility. Returns every scored name in rank order plus the selected top N.
 */
export function rankMomentum({bars,topN=MOMENTUM_DEFAULTS.topN,sectorOf=null,sectorMax=null,rankBy='raw',lookback=MOMENTUM_DEFAULTS.lookback,skip=MOMENTUM_DEFAULTS.skip,volWindow=MOMENTUM_DEFAULTS.volWindow}){
  if(!Number.isInteger(topN)||topN<1||topN>100)throw new Error('topN must be an integer from 1 to 100.')
  const ranked=[],skipped=[]
  for(const [symbol,series] of Object.entries(bars)){
    const i=series.length,raw=momentumScore(series,i,lookback,skip)
    if(raw===null){skipped.push({symbol,reason:`needs ${lookback} completed sessions, has ${i}`});continue}
    let score=raw,vol=null
    if(rankBy==='riskAdjusted'){vol=trailingVol(series,i,volWindow);if(!vol){skipped.push({symbol,reason:'no volatility estimate'});continue}score=raw/vol}
    ranked.push({symbol,score,raw,vol,sector:sectorOf?.(symbol)??null,lastClose:series[i-1].close,lastDate:toIso(series[i-1].date),recentClose:series[i-skip].close,recentDate:toIso(series[i-skip].date),oldClose:series[i-lookback].close,oldDate:toIso(series[i-lookback].date)})
  }
  ranked.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))
  ranked.forEach((r,k)=>{r.rank=k+1})
  const selected=[],counts=new Map()
  for(const r of ranked){
    if(selected.length>=topN)break
    if(sectorMax){const sec=r.sector??'Unknown',c=counts.get(sec)??0;if(c>=sectorMax){r.sectorCapped=true;continue}counts.set(sec,c+1)}
    selected.push(r.symbol)
  }
  return {ranked,selected,eligible:ranked.length,skipped}
}

/** What the rebalance would do, given the selection and what is held (symbol → qty). Budget is split equally. */
export function rebalancePlan({selected,held,budget,prices,topN=selected.length}){
  const heldMap=new Map(held.map(p=>[p.symbol,p.qty]))
  const sells=held.filter(p=>!selected.includes(p.symbol)).map(p=>({symbol:p.symbol,qty:p.qty,price:prices[p.symbol]??null}))
  const slot=topN>0?budget/topN:0
  const buys=selected.filter(s=>!heldMap.has(s)).map(symbol=>{const price=prices[symbol]??null;return {symbol,targetValue:Math.round(slot*100)/100,price,approxQty:price?Math.floor(slot/price):null}})
  const keep=selected.filter(s=>heldMap.has(s))
  return {sells,buys,keep,slot:Math.round(slot*100)/100}
}

/** The next monthly rebalance session on or after `todayIso`, from a calendar of {date} sessions (ascending). */
export function nextRebalanceSession(calendar,todayIso){
  const dates=calendar.map(d=>d.date).filter(Boolean).sort()
  for(let k=0;k<dates.length;k++){
    const d=dates[k];if(d<todayIso)continue
    const previous=dates[k-1]
    if(previous&&previous.slice(0,7)!==d.slice(0,7))return d
  }
  // Beyond the calendar window: the first weekday of the following month (holidays not accounted for).
  const [y,m]=todayIso.split('-').map(Number),first=new Date(Date.UTC(y,m,1))
  while(first.getUTCDay()%6===0)first.setUTCDate(first.getUTCDate()+1)
  return first.toISOString().slice(0,10)
}

function toIso(d){return d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10)}
