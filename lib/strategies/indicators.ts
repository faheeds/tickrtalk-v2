import type { Bar } from './types'

// ── True Range / ATR (Wilder smoothing) ──────────────────────────────────────
export function calcATR(bars: Bar[], period = 14): number[] {
  const tr: number[] = []
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)))
  }
  if (tr.length < period) return []
  const atr: number[] = []
  let seed = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
  atr.push(seed)
  for (let i = period; i < tr.length; i++) {
    seed = (seed * (period - 1) + tr[i]) / period
    atr.push(seed)
  }
  return atr  // length = bars.length - period
}

// ── SuperTrend ────────────────────────────────────────────────────────────────
export interface SuperTrendResult {
  supertrend: (number | null)[]  // same length as bars
  direction:  (1 | -1 | null)[]  // 1 = bullish, -1 = bearish
}

export function calcSuperTrend(bars: Bar[], period = 10, multiplier = 3.0): SuperTrendResult {
  const n=bars.length, atr=calcATR(bars,period)
  const st:(number|null)[]=new Array(n).fill(null), dir:(1|-1|null)[]=new Array(n).fill(null)
  const upper:number[]=[],lower:number[]=[]
  for(let i=period;i<n;i++){
    const value=atr[i-period]
    if(!Number.isFinite(value))continue
    const middle=(bars[i].high+bars[i].low)/2, basicUpper=middle+multiplier*value,basicLower=middle-multiplier*value
    if(i===period){upper[i]=basicUpper;lower[i]=basicLower;dir[i]=-1;st[i]=upper[i];continue}
    upper[i]=basicUpper<upper[i-1]||bars[i-1].close>upper[i-1]?basicUpper:upper[i-1]
    lower[i]=basicLower>lower[i-1]||bars[i-1].close<lower[i-1]?basicLower:lower[i-1]
    dir[i]=st[i-1]===upper[i-1]?(bars[i].close>upper[i]?1:-1):(bars[i].close<lower[i]?-1:1)
    st[i]=dir[i]===1?lower[i]:upper[i]
  }
  return {supertrend:st,direction:dir}
}

// ── Simple Moving Average ─────────────────────────────────────────────────────
export function calcSMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  })
}

// ── Exponential Moving Average ────────────────────────────────────────────────
export function calcEMA(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const out: (number | null)[] = []
  let ema: number | null = null
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(null); continue }
    if (ema === null) { ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period }
    else { ema = values[i] * k + ema * (1 - k) }
    out.push(+ema.toFixed(4))
  }
  return out
}

// ── Relative Strength Index ───────────────────────────────────────────────────
export function calcRSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null]
  let ag = 0, al = 0
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    if (i < period) { ag += g / period; al += l / period; out.push(null); continue }
    if (i === period) {
      ag += g / period
      al += l / period
      out.push(al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2))
      continue
    }
    ag = (ag * (period - 1) + g) / period
    al = (al * (period - 1) + l) / period
    out.push(al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2))
  }
  return out
}

// ── Intraday VWAP (cumulative from first bar of session) ──────────────────────
export function calcVWAP(bars: Bar[]): number[] {
  let cumTPV = 0, cumVol = 0
  return bars.map(b => {
    cumTPV += ((b.high + b.low + b.close) / 3) * b.volume
    cumVol += b.volume
    return cumVol > 0 ? cumTPV / cumVol : b.close
  })
}
