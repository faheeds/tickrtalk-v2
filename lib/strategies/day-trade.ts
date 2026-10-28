/** Opening Range Breakout with VWAP. Legacy scanner retained for reference; the paper service owns execution. No performance claim has been validated. */
import type { Signal, StrategyResult } from './types'
import { calcVWAP }                    from './indicators'
import type { AlpacaClient }           from '@/lib/alpaca'
import { HALAL_SYMBOLS }               from '@/lib/halal'

const ORB_MINUTES   = 30    // 9:30–10:00 AM ET
const RISK_PCT      = 0.02  // 2% of day budget per trade
const MAX_POSITIONS = 2

export async function runDayStrategy(
  alpaca:          AlpacaClient,
  budget:          number,
  currentExposure: number,
): Promise<StrategyResult> {
  const ts = new Date().toISOString()
  if (budget === 0)
    return { signals: [], scanned: 0, errors: ['Day budget not set'], strategy: 'day', timestamp: ts }

  // Time gate: only scan 10:00–15:30 ET (after ORB forms, before close-out window)
  // UTC-4 in summer (EDT); winter adds 1hr but getClock() handles market-open check
  const now    = new Date()
  const etMin  = (now.getUTCHours() - 4) * 60 + now.getUTCMinutes()
  if (etMin < 10 * 60 || etMin > 15 * 60 + 30) {
    return { signals: [], scanned: 0, errors: ['Outside ORB window (10:00–15:30 ET)'], strategy: 'day', timestamp: ts }
  }

  const available = Math.max(0, budget - currentExposure)
  const positions = await alpaca.getPositions().catch(() => [])
  if (positions.length >= MAX_POSITIONS)
    return { signals: [], scanned: 0, errors: [`At max ${MAX_POSITIONS} simultaneous day positions`], strategy: 'day', timestamp: ts }
  if (available < 300)
    return { signals: [], scanned: 0, errors: ['Day budget fully deployed'], strategy: 'day', timestamp: ts }

  const signals: Signal[] = []
  const errors:  string[] = []
  const held     = new Set(positions.map(p => p.symbol))

  // Tighter universe for day trading — top 80 liquid halal large-caps only
  const universe = HALAL_SYMBOLS.slice(0, 80)
  let scanned    = 0

  for (const symbol of universe) {
    if (signals.length >= MAX_POSITIONS - positions.length) break
    if (held.has(symbol)) continue
    try {
      const intradayBars = await alpaca.getIntradayBars(symbol, '1Min', 1)
      if (intradayBars.length < ORB_MINUTES + 5) { scanned++; continue }

      // Filter to today's bars only
      const todayStr  = new Date().toDateString()
      const todayBars = intradayBars.filter(b => new Date(b.date).toDateString() === todayStr)
      if (todayBars.length < ORB_MINUTES + 5) { scanned++; continue }

      // Opening range = first 30 bars (9:30–10:00 AM)
      const orbBars   = todayBars.slice(0, ORB_MINUTES)
      const postBars  = todayBars.slice(ORB_MINUTES)
      const orHigh    = Math.max(...orbBars.map(b => b.high))
      const orLow     = Math.min(...orbBars.map(b => b.low))
      const orWidth   = orHigh - orLow
      if (orWidth / orHigh < 0.001) { scanned++; continue }  // too narrow (flat open)

      const orbAvgVol = orbBars.reduce((s, b) => s + b.volume, 0) / ORB_MINUTES
      const latest    = postBars[postBars.length - 1]
      const prevBar   = postBars.length >= 2
        ? postBars[postBars.length - 2]
        : orbBars[ORB_MINUTES - 1]

      // VWAP for entire session so far
      const vwapArr    = calcVWAP(todayBars)
      const latestVWAP = vwapArr[todayBars.length - 1]

      // All 4 conditions must be true for a valid ORB breakout
      const isBreakout =
        prevBar.close  <= orHigh * 1.002 &&   // was at/below OR high previously
        latest.close   >  orHigh &&             // now closed above
        latest.volume  >  orbAvgVol * 1.5 &&   // volume surge ≥1.5×
        latest.close   >  latestVWAP            // above VWAP (bullish bias)

      if (!isBreakout) { scanned++; continue }

      const entryPrice  = +(orHigh * 1.001).toFixed(2)
      // Stop is OR low, but floor at 50% of range to avoid oversized risk on wide ranges
      const stopPrice   = +(Math.max(orLow, orHigh - orWidth * 0.5)).toFixed(2)
      const targetPrice = +(entryPrice + orWidth * 1.5).toFixed(2)
      const risk        = entryPrice - stopPrice
      if (risk <= 0) { scanned++; continue }

      const riskDollars = budget * RISK_PCT
      const qty         = Math.min(
        Math.floor(riskDollars / risk),
        Math.floor(available / entryPrice),
      )
      if (qty < 1) { scanned++; continue }

      signals.push({
        symbol, strategy: 'day', action: 'BUY',
        price: entryPrice, stopPrice, targetPrice, qty,
        reason: `ORB breakout $${orHigh.toFixed(2)} | Width=$${orWidth.toFixed(2)} | Vol=${(latest.volume / orbAvgVol).toFixed(1)}x avg | VWAP=$${latestVWAP.toFixed(2)}`,
        timestamp: ts,
      })
      scanned++
    } catch (e) {
      errors.push(`${symbol}: ${(e as Error).message}`)
      scanned++
    }
  }

  return { signals, scanned, errors, strategy: 'day', timestamp: ts }
}
