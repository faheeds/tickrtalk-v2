/** Price momentum filters. This is not a financial quality-factor implementation. Legacy scanner retained for reference; the paper service owns execution. */
import type { Signal, StrategyResult } from './types'
import { calcSMA, calcRSI }            from './indicators'
import type { AlpacaClient }           from '@/lib/alpaca'
import { HALAL_SYMBOLS }               from '@/lib/halal'

const MAX_POSITIONS = 8
const MOM_LOOKBACK  = 126  // ~6 months of trading days
const HIGH_LOOKBACK = 252  // 52-week lookback
const RSI_MIN = 50, RSI_MAX = 75

export async function runLongtermStrategy(
  alpaca:          AlpacaClient,
  budget:          number,
  currentExposure: number,
): Promise<StrategyResult> {
  const ts = new Date().toISOString()
  if (budget === 0)
    return { signals: [], scanned: 0, errors: ['Long-term budget not set'], strategy: 'longterm', timestamp: ts }

  const signals: Signal[] = []
  const errors:  string[] = []

  const positions = await alpaca.getPositions().catch(() => [])
  const held      = new Set(positions.map(p => p.symbol))
  const available = Math.max(0, budget - currentExposure)
  const openSlots = MAX_POSITIONS - held.size

  // ── Exit check: scan held positions for death cross ─────────────────────────
  for (const pos of positions) {
    try {
      const bars = await alpaca.getBars(pos.symbol, 14)
      if (bars.length < 210) continue
      const closes = bars.map(b => b.close)
      const n      = closes.length
      const sma50  = calcSMA(closes, 50)
      const sma200 = calcSMA(closes, 200)
      // Death cross: was golden (50 ≥ 200), now bearish (50 < 200)
      if (
        sma50[n - 2] !== null && sma200[n - 2] !== null &&
        sma50[n - 1] !== null && sma200[n - 1] !== null &&
        sma50[n - 2]! >= sma200[n - 2]! &&
        sma50[n - 1]!  < sma200[n - 1]!
      ) {
        signals.push({
          symbol: pos.symbol, strategy: 'longterm', action: 'SELL',
          price: bars[n - 1].close, stopPrice: 0, targetPrice: 0, qty: pos.qty,
          reason: 'Death cross: 50-day SMA crossed below 200-day SMA — exit signal',
          timestamp: ts,
        })
      }
    } catch (e) { errors.push(`exit ${pos.symbol}: ${(e as Error).message}`) }
  }

  if (openSlots <= 0 || available < 1000) {
    return { signals, scanned: 0, errors: [...errors, 'No open slots or insufficient budget'], strategy: 'longterm', timestamp: ts }
  }

  // ── Entry scoring: rank halal universe by momentum ───────────────────────────
  const universe = HALAL_SYMBOLS.slice(0, 150)
  const scored: Array<{ symbol: string; momentum: number; entryPrice: number; sma200val: number }> = []
  let scanned = 0

  for (const symbol of universe) {
    if (held.has(symbol)) continue
    try {
      const bars = await alpaca.getBars(symbol, 14)  // 14 months ≈ 252+ trading days
      if (bars.length < HIGH_LOOKBACK + 10) { scanned++; continue }

      const closes = bars.map(b => b.close)
      const n      = closes.length
      const sma50  = calcSMA(closes, 50)
      const sma200 = calcSMA(closes, 200)
      const rsi    = calcRSI(closes, 14)

      if (!sma50[n - 1] || !sma200[n - 1] || rsi[n - 1] === null) { scanned++; continue }
      if (sma50[n - 1]! <= sma200[n - 1]!)                          { scanned++; continue }  // must be golden cross
      const rsiVal = rsi[n - 1]!
      if (rsiVal < RSI_MIN || rsiVal > RSI_MAX)                      { scanned++; continue }  // trending but not overbought

      const yearHigh = Math.max(...closes.slice(-HIGH_LOOKBACK))
      if (closes[n - 1] < yearHigh * 0.80)                           { scanned++; continue }  // >20% off highs = weakness

      if (n < MOM_LOOKBACK + 5)                                       { scanned++; continue }
      const momentum = (closes[n - 1] - closes[n - 1 - MOM_LOOKBACK]) / closes[n - 1 - MOM_LOOKBACK]

      scored.push({ symbol, momentum, entryPrice: closes[n - 1], sma200val: sma200[n - 1]! })
      scanned++
    } catch (e) { errors.push(`${symbol}: ${(e as Error).message}`); scanned++ }
  }

  // Sort by 6-month return descending, pick top available slots
  scored.sort((a, b) => b.momentum - a.momentum)
  const picks   = scored.slice(0, openSlots)
  const perSlot = available / Math.max(picks.length, 1)

  for (const pick of picks) {
    const entryPrice = +(pick.entryPrice * 1.001).toFixed(2)
    const qty        = Math.floor(perSlot / entryPrice)
    if (qty < 1) continue
    // Stop = 2% below 200-day SMA (tight enough to exit if trend cracks)
    const stopPrice  = +(pick.sma200val * 0.98).toFixed(2)
    signals.push({
      symbol: pick.symbol, strategy: 'longterm', action: 'BUY',
      price: entryPrice, stopPrice, targetPrice: 0, qty,
      reason: `Quality Momentum: 6M return=${(pick.momentum * 100).toFixed(1)}% | Golden Cross | RSI=${pick.symbol}`,
      timestamp: ts,
    })
  }

  return { signals, scanned, errors, strategy: 'longterm', timestamp: ts }
}
