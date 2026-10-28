import { createHash } from 'node:crypto'
import { calcATR, calcSuperTrend, calcSMA, calcRSI, calcVWAP } from '../../lib/strategies/indicators.ts'

export const DEFAULT_DRAFT = {
  universeMode:'custom',universeAsOf:null,universeSource:null,
  universe: ['AAPL', 'MSFT', 'NVDA'],
  risk: {maxBudget: 1000, maxOrder: 500, maxPositions: 2, riskPct: 0.5, dailyLossPct: 2, maxSpreadPct: 0.5, quoteAgeSeconds: 90, entryExpiryMinutes: 5, flattenMinutes: 5, requireHalal: false},
  day: {enabled: true, orbMinutes: 30, volumeFactor: 1.5, rewardMultiple: 1.5},
  swing: {enabled: true, trendPeriod: 10, trendMultiplier: 3, atrPeriod: 14, rewardMultiple: 2},
  longterm: {enabled: true, fastSma: 50, slowSma: 200, momentumDays: 126, rsiMin: 50, rsiMax: 75},
}
export const TERMINAL = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced'])
export const isOpen = order => !TERMINAL.has(order.status)
export const number = value => { const n = Number(value); if (!Number.isFinite(n)) throw new Error('Broker returned an invalid number.'); return n }
export const round = n => Math.round((n + Number.EPSILON) * 100) / 100
const easternFormatter=new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'})
export function eastern(date) {
  const parts = Object.fromEntries(easternFormatter.formatToParts(new Date(date)).map(p => [p.type,p.value]))
  return {date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour)*60+Number(parts.minute)}
}
export function validateDraft(raw) {
  const draft = structuredClone(DEFAULT_DRAFT)
  if (!raw || typeof raw !== 'object') throw new Error('A strategy draft is required.')
  if (!Array.isArray(raw.universe) || !raw.universe.length || raw.universe.length > 600 || raw.universe.some(s => typeof s !== 'string' || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(s))) throw new Error('Use 1 to 600 unique stock symbols.')
  draft.universe = [...new Set(raw.universe)]
  if(raw.universeMode!==undefined&&!['custom','sp500'].includes(raw.universeMode))throw new Error('Choose a custom list or the S&P 500 universe.')
  draft.universeMode=raw.universeMode??'custom'
  if(draft.universeMode==='sp500'){
    if(draft.universe.length<450||typeof raw.universeAsOf!=='string'||!Number.isFinite(new Date(raw.universeAsOf).getTime())||typeof raw.universeSource!=='string')throw new Error('The S&P 500 draft requires a sourced constituent snapshot.')
    draft.universeAsOf=raw.universeAsOf;draft.universeSource=raw.universeSource
  }
  const bounds = {risk:{maxBudget:[100,100000], maxOrder:[1,10000], maxPositions:[1,8], riskPct:[0.1,2], dailyLossPct:[0.1,10], maxSpreadPct:[0.01,2], quoteAgeSeconds:[10,120], entryExpiryMinutes:[1,30], flattenMinutes:[3,30]}, day:{orbMinutes:[15,60],volumeFactor:[1,5],rewardMultiple:[1,5]}, swing:{trendPeriod:[5,30],trendMultiplier:[1,5],atrPeriod:[5,30],rewardMultiple:[1,5]},longterm:{fastSma:[10,100],slowSma:[100,252],momentumDays:[30,252],rsiMin:[30,70],rsiMax:[50,90]}}
  const integers = new Set(['maxPositions','quoteAgeSeconds','entryExpiryMinutes','flattenMinutes','orbMinutes','trendPeriod','atrPeriod','fastSma','slowSma','momentumDays'])
  for (const [group, fields] of Object.entries(bounds)) for (const [key,[min,max]] of Object.entries(fields)) {
    const value = raw[group]?.[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value<min || value>max || (integers.has(key) && !Number.isInteger(value))) throw new Error(`Invalid ${key}: use ${min} to ${max}.`)
    draft[group][key] = value
  }
  for (const style of ['day','swing','longterm']) { if (typeof raw[style]?.enabled !== 'boolean') throw new Error('A style enabled flag is required.'); draft[style].enabled = raw[style].enabled }
  if (typeof raw.risk?.requireHalal !== 'boolean') throw new Error('Screening policy is required.')
  draft.risk.requireHalal = raw.risk.requireHalal
  if (draft.risk.maxOrder > draft.risk.maxBudget || draft.longterm.fastSma >= draft.longterm.slowSma || draft.longterm.rsiMin >= draft.longterm.rsiMax) throw new Error('Review order limits and indicator ranges.')
  return draft
}
export function session(clock, calendar) {
  const now = new Date(clock.timestamp), et = eastern(now)
  if (!Number.isFinite(now.getTime())) throw new Error('Market clock is invalid.')
  const day = calendar.find(row => row.date === et.date)
  if (!day && clock.is_open===true) throw new Error('Open market clock has no matching calendar session.')
  if (!day) return {date:et.date, open:false, now, minutes:et.minutes, openMinute:570,closeMinute:960}
  const minutes = value => { const [h,m]=value.split(':').map(Number); return h*60+m }
  return {date:et.date,open:clock.is_open===true,now,minutes:et.minutes,openMinute:minutes(day.open),closeMinute:minutes(day.close)}
}
export function completedBars(raw, now, intraday = false) {
  const time = new Date(now).getTime(), today = eastern(now).date
  return raw.filter(b => {
    const timestamp = new Date(b.t).getTime()
    if (!Number.isFinite(timestamp) || ![b.o,b.h,b.l,b.c,b.v].every(n => Number.isFinite(n) && n >= 0) || b.c<=0 || b.l<=0 || b.h<b.l) return false
    return intraday ? timestamp+60000<=time && eastern(b.t).date===today && eastern(b.t).minutes>=570 && eastern(b.t).minutes<960 : eastern(b.t).date<today
  }).sort((a,b)=>new Date(a.t)-new Date(b.t)).map(b=>({date:new Date(b.t),open:b.o,high:b.h,low:b.l,close:b.c,volume:b.v,vwap:b.vw??null}))
}
export function evaluate(style, bars, profile, market) {
  if (!profile.enabled) return null
  const n=bars.length, last=bars[n-1]
  if (!last) return null
  if (style === 'day') {
    const orb = bars.filter(b => eastern(b.date).minutes>=market.openMinute && eastern(b.date).minutes<market.openMinute+profile.orbMinutes)
    if (orb.length!==profile.orbMinutes || orb.some((b,i)=>eastern(b.date).minutes!==market.openMinute+i)) return null
    const post = bars.filter(b=>eastern(b.date).minutes>=market.openMinute+profile.orbMinutes)
    if (!post.length) return null
    const previous = post.length>1?post.at(-2):orb.at(-1), high=Math.max(...orb.map(b=>b.high)),low=Math.min(...orb.map(b=>b.low)),width=high-low
    const average=orb.reduce((sum,b)=>sum+b.volume,0)/orb.length,vwap=calcVWAP(bars).at(-1)
    if (width<=0 || average<=0 || !(previous.close<=high*1.002 && last.close>high && last.volume>average*profile.volumeFactor && last.close>vwap)) return null
    return {side:'buy',price:last.close,stop:round(Math.max(low,high-width*.5)),target:round(last.close+width*profile.rewardMultiple),bar:last.date.toISOString(),reason:'Completed opening-range breakout with VWAP and volume confirmation.'}
  }
  if (style==='swing') {
    if (n<profile.trendPeriod+profile.atrPeriod+10) return null
    const trend=calcSuperTrend(bars,profile.trendPeriod,profile.trendMultiplier),atr=calcATR(bars,profile.atrPeriod).at(-1)
    if (trend.direction[n-2]!==-1 || trend.direction[n-1]!==1 || !atr) return null
    const stop=round(trend.supertrend[n-1]*.995)
    if (stop<=0 || stop>=last.close || (last.close-stop)/last.close>.08) return null
    return {side:'buy',price:last.close,stop,target:round(last.close+profile.rewardMultiple*atr),bar:last.date.toISOString(),reason:'Completed daily SuperTrend bullish crossover with ATR risk sizing.'}
  }
  const closes=bars.map(b=>b.close)
  if (n<Math.max(profile.slowSma+2,profile.momentumDays+2,252)) return null
  const fast=calcSMA(closes,profile.fastSma),slow=calcSMA(closes,profile.slowSma),rsi=calcRSI(closes,14)
  if (fast[n-2]>=slow[n-2] && fast[n-1]<slow[n-1]) return {side:'sell',price:last.close,bar:last.date.toISOString(),reason:'Completed daily momentum-trend exit.'}
  if (fast[n-1]<=slow[n-1] || rsi[n-1]<profile.rsiMin || rsi[n-1]>profile.rsiMax || last.close<Math.max(...closes.slice(-252))*.8) return null
  return {side:'buy',price:last.close,stop:round(slow[n-1]*.98),target:0,bar:last.date.toISOString(),score:last.close/closes[n-1-profile.momentumDays]-1,reason:'Daily momentum trend, moving-average alignment, and RSI filter.'}
}
export function freshQuote(quote, now, risk) {
  const age=(new Date(now)-new Date(quote?.t))/1000
  if (!quote || !Number.isFinite(age) || age< -5 || age>risk.quoteAgeSeconds || !Number.isFinite(quote.bp) || !Number.isFinite(quote.ap) || quote.bp<=0 || quote.ap<quote.bp) throw new Error('Quote is stale or incomplete.')
  if ((quote.ap-quote.bp)/quote.ap*100>risk.maxSpreadPct) throw new Error('Spread exceeds the published limit.')
  return quote
}
export function sizeEntry({budget,remaining,cash,signal,quote,risk}) {
  const price=round(quote.ap*1.001),distance=price-signal.stop
  if (![budget,remaining,cash,price,signal.stop,distance].every(Number.isFinite) || distance<.01 || signal.stop<=0 || (signal.target && signal.target<=price)) return null
  const qty=Math.floor(Math.min(budget*risk.riskPct/100/distance,remaining/price,cash/price,risk.maxOrder/price))
  return qty>=1?{qty,price,stop:signal.stop,target:signal.target}:null
}
export function clientId(...parts) { return 'tt_p_'+createHash('sha256').update(parts.join('|')).digest('hex').slice(0,36) }
export function entryBody(symbol, sized, style, id) {
  if (!Number.isInteger(sized.qty) || sized.qty<1 || !(sized.stop>0 && sized.stop<sized.price) || (sized.target && sized.target<=sized.price)) throw new Error('Invalid protected entry.')
  return {symbol,qty:String(sized.qty),side:'buy',type:'limit',limit_price:sized.price.toFixed(2),time_in_force:style==='day'?'day':'gtc',extended_hours:false,client_order_id:id,order_class:sized.target?'bracket':'oto',stop_loss:{stop_price:sized.stop.toFixed(2)},...(sized.target?{take_profit:{limit_price:sized.target.toFixed(2)}}:{})}
}
export function flattenOrders(order) { return [order,...(order.legs??[]).flatMap(flattenOrders)] }
export function strictHalal(result) {
  return result?.verdict?.cls==='pass' && result.verdict.activityStatus==='pass' && Array.isArray(result.ratios) && result.ratios.length>=3 && result.ratios.every(r=>r.status==='pass') && Number.isFinite(new Date(result.generatedAt).getTime()) && Date.now()-new Date(result.generatedAt)>=0 && Date.now()-new Date(result.generatedAt)<24*3600000
}
