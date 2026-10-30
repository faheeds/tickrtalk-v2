/**
 * BLEND — four equal-weight, long-only, daily-bar sleeves. Pure signal logic:
 * no network, no database, no clock. The runner (lib/blend-runner.ts) feeds it bars
 * and positions and places the orders.
 *
 *   mom    Monthly. Rank halal universe by 12-1 month momentum / 60-day volatility.
 *          Buy top 10 that are above their 200-day SMA; sell when rank falls past 20.   (10 slots)
 *   down3  Buy after 3 consecutive lower closes while above the 200-day SMA;
 *          sell when close > 5-day SMA.                                                  (10 slots)
 *   ibs    Buy when internal bar strength (C-L)/(H-L) < 0.15; sell when close
 *          exceeds the prior day's high.                                                 (10 slots)
 *   crsi   Buy when RSI(2) + prior-day RSI(2) < 35 above the 200-day SMA;
 *          sell when RSI(2) > 65.                                                        (20 slots)
 *
 * mom / down3 / ibs only open new positions while SPY closes above its 200-day SMA.
 * Decisions use the last COMPLETED daily bar; orders go in at the next open.
 *
 * Verified against research/blend/blend_ref.py (the code behind the backtest):
 *   node --experimental-strip-types --no-warnings --test lib/strategies/blend-core.test.mjs
 */

export type Sleeve = 'mom' | 'down3' | 'ibs' | 'crsi'

export interface Bar { date: string; o: number; h: number; l: number; c: number }

export interface SleeveMeta {
  label:   string
  blurb:   string
  slots:   number
  gated:   boolean   // new entries only while SPY > 200-day SMA
  monthly: boolean
}

export const SLEEVE_ORDER: Sleeve[] = ['mom', 'down3', 'ibs', 'crsi']

export const BLEND_SLEEVES: Record<Sleeve, SleeveMeta> = {
  mom:   { label: 'Momentum',      blurb: 'Monthly: top 10 by momentum ÷ volatility, above 200-day average',        slots: 10, gated: true,  monthly: true  },
  down3: { label: '3-day dip',     blurb: 'Buy 3 straight lower closes in an uptrend, sell on a bounce above 5-day average', slots: 10, gated: true,  monthly: false },
  ibs:   { label: 'Weak close',    blurb: 'Buy a close near the day\'s low, sell when price clears yesterday\'s high', slots: 10, gated: true,  monthly: false },
  crsi:  { label: 'RSI(2) dip',    blurb: 'Buy deeply oversold 2-day RSI in an uptrend, sell when RSI(2) > 65',      slots: 20, gated: false, monthly: false },
}

export const BLEND_LIMITS = { minBudget: 20_000, maxBudget: 10_000_000 } as const
export const MIN_BARS = 275   // 252-bar momentum lookback + margin

/** The 94 halal-screened, liquid names the strategy was backtested on (2011-2026). */
export const BLEND_UNIVERSE: readonly string[] = ['AAPL','MSFT','NVDA','META','AMZN','GOOGL','AMD','AVGO','MRVL','ON','MPWR','AMAT','LRCX','KLAC','MCHP','QCOM','TXN','ADI','NXPI','SWKS','MU','WDC','STX','NTAP','CSCO','ANET','KEYS','DDOG','CRWD','ZS','PANW','FTNT','CRM','NOW','WDAY','ADP','PAYX','CDNS','ADSK','ORCL','SPGI','MCO','ICE','CME','NDAQ','ECL','APD','LIN','SHW','PPG','DOW','VMC','MLM','NUE','STLD','POOL','WM','RSG','IDXX','MTD','ALGN','REGN','VRTX','ISRG','SYK','EW','BSX','ABT','TMO','DHR','TSLA','UBER','BKNG','V','MA','NKE','LULU','ROST','TJX','EBAY','NFLX','XOM','CVX','COP','EOG','SLB','NEE','ITW','ROK','EMR','HON','PLD','AMT','EQIX']

// ── indicators ───────────────────────────────────────────────────────────────

export interface Indicators {
  close:    number
  sma5:     number | null
  sma200:   number | null
  rsi2:     number | null
  cumrsi2:  number | null
  ibs:      number | null
  prevHigh: number | null
  ret3:     number | null
  down3:    boolean
  mom:      number | null
  vol60:    number | null
  momvol:   number | null
}

const fin = (x: number): number | null => (Number.isFinite(x) ? x : null)

function smaLast(c: number[], n: number): number | null {
  if (c.length < n) return null
  let s = 0
  for (let i = c.length - n; i < c.length; i++) s += c[i]
  return s / n
}

/** Wilder-style RSI via recursive smoothing with alpha = 1/n, seeded at the first difference
 *  (identical to pandas ewm(alpha=1/n, adjust=False)). Returns the whole series. */
export function rsiSeries(c: number[], n = 2): Array<number | null> {
  const a = 1 / n
  const out: Array<number | null> = new Array(c.length).fill(null)
  let up = 0, dn = 0
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    const u = d > 0 ? d : 0
    const w = d < 0 ? -d : 0
    if (i === 1) { up = u; dn = w } else { up = (1 - a) * up + a * u; dn = (1 - a) * dn + a * w }
    if (dn === 0) out[i] = up === 0 ? null : 100          // 0/0 is undefined, x/0 saturates at 100
    else out[i] = 100 - 100 / (1 + up / dn)
  }
  return out
}

function std60(c: number[]): number | null {
  const n = c.length
  if (n < 61) return null
  const r: number[] = []
  for (let i = n - 60; i < n; i++) r.push(c[i] / c[i - 1] - 1)
  const m = r.reduce((s, x) => s + x, 0) / 60
  const v = r.reduce((s, x) => s + (x - m) * (x - m), 0) / 59   // sample std, like pandas
  return fin(Math.sqrt(v))
}

/** Indicators as of the LAST bar. Returns null when there is not enough history. */
export function computeIndicators(bars: Bar[]): Indicators | null {
  const n = bars.length
  if (n < MIN_BARS) return null
  const c = bars.map(b => b.c)
  const last = bars[n - 1], prev = bars[n - 2]
  const rsi = rsiSeries(c, 2)
  const r0 = rsi[n - 1], r1 = rsi[n - 2]
  const mom = fin(c[n - 1 - 21] / c[n - 1 - 252] - 1)
  const vol60 = std60(c)
  return {
    close:    last.c,
    sma5:     smaLast(c, 5),
    sma200:   smaLast(c, 200),
    rsi2:     r0,
    cumrsi2:  r0 !== null && r1 !== null ? r0 + r1 : null,
    ibs:      last.h === last.l ? null : (last.c - last.l) / (last.h - last.l),
    prevHigh: prev.h,
    ret3:     fin(c[n - 1] / c[n - 4] - 1),
    down3:    c[n - 1] < c[n - 2] && c[n - 2] < c[n - 3] && c[n - 3] < c[n - 4],
    mom,
    vol60,
    momvol:   mom !== null && vol60 !== null && vol60 !== 0 ? fin(mom / vol60) : null,
  }
}

/** true = SPY above its 200-day SMA, false = below, null = not enough data. */
export function regimeOn(spy: Bar[]): boolean | null {
  const c = spy.map(b => b.c)
  const s = smaLast(c, 200)
  return s === null ? null : c[c.length - 1] > s
}

// ── planning ─────────────────────────────────────────────────────────────────

export interface PlanInput {
  /** Completed daily bars per symbol, ascending; the last bar is the decision bar. */
  universe: Record<string, Bar[]>
  spy:      Bar[]
  /** Open positions per sleeve (shares held; eligible for exit signals). */
  held:     Record<Sleeve, string[]>
  /** Orders still working per sleeve: occupy a slot and block re-entry, but cannot be exited yet. */
  pending?: Partial<Record<Sleeve, string[]>>
  /** True when the decision bar was the last trading day of its month (monthly rebalance). */
  monthEnd: boolean
  /** Held symbols that must be sold regardless of signals (e.g. no longer halal-verified). */
  forceExit?: ReadonlySet<string>
}

export interface PlannedOrder {
  sleeve:   Sleeve
  side:     'buy' | 'sell'
  symbol:   string
  refPrice: number          // last close, for sizing and display only
  score:    number | null
  reason:   string
}

export interface Plan {
  regime:    boolean | null
  orders:    PlannedOrder[]
  evaluated: number         // symbols with enough data
  noData:    string[]       // symbols skipped for short history
}

/** Average rank, 1 = largest. Ties share the mean rank, like pandas rank(ascending=False). */
function rankDesc(values: Array<[string, number]>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [s, v] of values) {
    let greater = 0, equal = 0
    for (const [, w] of values) { if (w > v) greater++; else if (w === v) equal++ }
    out.set(s, greater + (equal + 1) / 2)
  }
  return out
}

const pct = (x: number | null, d = 1) => (x === null ? 'n/a' : (x * 100).toFixed(d) + '%')

export function planBlend(input: PlanInput): Plan {
  const ind = new Map<string, Indicators>()
  const noData: string[] = []
  for (const [sym, bars] of Object.entries(input.universe)) {
    const x = computeIndicators(bars)
    if (x) ind.set(sym, x); else noData.push(sym)
  }
  const regime = regimeOn(input.spy)
  const rank = rankDesc([...ind].filter(([, x]) => x.momvol !== null).map(([s, x]) => [s, x.momvol as number]))
  const orders: PlannedOrder[] = []

  for (const sleeve of SLEEVE_ORDER) {
    const meta = BLEND_SLEEVES[sleeve]
    const held = input.held[sleeve] ?? []
    const pending = input.pending?.[sleeve] ?? []
    const exiting = new Set<string>()

    // exits — only for symbols we actually hold shares in
    for (const sym of held) {
      const x = ind.get(sym)
      let reason: string | null = null
      if (input.forceExit?.has(sym)) reason = 'No longer halal-verified'
      else if (x) {
        if (sleeve === 'mom') {
          const r = rank.get(sym)
          if (input.monthEnd && r !== undefined && r > 20) reason = `Monthly rebalance: momentum rank ${r} fell outside top 20`
        } else if (sleeve === 'down3' && x.sma5 !== null && x.close > x.sma5) reason = 'Bounce: close above 5-day average'
        else if (sleeve === 'ibs' && x.close > (x.prevHigh as number)) reason = "Close above prior day's high"
        else if (sleeve === 'crsi' && x.rsi2 !== null && x.rsi2 > 65) reason = `RSI(2) ${x.rsi2.toFixed(0)} > 65`
      }
      if (reason) {
        exiting.add(sym)
        orders.push({ sleeve, side: 'sell', symbol: sym, refPrice: x?.close ?? 0, score: null, reason })
      }
    }

    // entries
    const slots = meta.slots - (held.length - exiting.size) - pending.length
    if (slots <= 0) continue
    if (meta.gated && regime !== true) continue
    if (meta.monthly && !input.monthEnd) continue
    const taken = new Set([...held, ...pending])
    const cands: Array<{ sym: string; score: number; reason: string; px: number }> = []
    for (const [sym, x] of ind) {
      if (taken.has(sym)) continue
      const trend = x.sma200 !== null && x.close > x.sma200
      if (sleeve === 'mom') {
        const r = rank.get(sym)
        if (r !== undefined && r <= 10 && trend && x.momvol !== null)
          cands.push({ sym, score: x.momvol, px: x.close, reason: `Momentum rank ${r} (12-1m ${pct(x.mom)}, vol ${pct(x.vol60, 2)}/day)` })
      } else if (sleeve === 'down3') {
        if (x.down3 && trend && x.ret3 !== null)
          cands.push({ sym, score: -x.ret3, px: x.close, reason: `3 straight down closes (${pct(x.ret3)}) above 200-day average` })
      } else if (sleeve === 'ibs') {
        if (x.ibs !== null && x.ibs < 0.15)
          cands.push({ sym, score: -x.ibs, px: x.close, reason: `Weak close: IBS ${x.ibs.toFixed(2)} (< 0.15)` })
      } else if (x.cumrsi2 !== null && x.cumrsi2 < 35 && trend) {
        cands.push({ sym, score: -x.cumrsi2, px: x.close, reason: `Oversold: RSI(2)+prior ${x.cumrsi2.toFixed(0)} (< 35) above 200-day average` })
      }
    }
    cands.sort((a, b) => b.score - a.score || (a.sym < b.sym ? -1 : 1))
    for (const c of cands.slice(0, slots))
      orders.push({ sleeve, side: 'buy', symbol: c.sym, refPrice: c.px, score: c.score, reason: c.reason })
  }

  return { regime, orders, evaluated: ind.size, noData }
}

// ── sizing & calendar helpers ────────────────────────────────────────────────

/** Each sleeve gets an equal quarter of the budget; each slot an equal share of the sleeve. */
export function slotDollars(budget: number, sleeve: Sleeve): number {
  return budget / SLEEVE_ORDER.length / BLEND_SLEEVES[sleeve].slots
}

export function sizeQty(budget: number, sleeve: Sleeve, price: number): number {
  if (!(price > 0)) return 0
  return Math.floor(slotDollars(budget, sleeve) / price)
}

/** The decision bar closed the month if today (ET) is in a later month than the bar. */
export function isMonthEndDecision(lastBarDate: string, todayET: string): boolean {
  return lastBarDate.slice(0, 7) !== todayET.slice(0, 7)
}
