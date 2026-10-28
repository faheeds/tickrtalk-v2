/** SuperTrend and ATR. Legacy scanner retained for reference; the paper service owns execution. No performance claim has been validated. */
import type { Signal, StrategyResult } from './types'
import { calcSuperTrend, calcATR }     from './indicators'
import type { AlpacaClient }           from '@/lib/alpaca'
import { HALAL_SYMBOLS }               from '@/lib/halal'

const ST_PERIOD     = 10
const ST_MULTIPLIER = 3.0
const ATR_PERIOD    = 14
const RISK_PCT      = 0.01   // 1% of budget risked per trade
const MAX_SIGNALS   = 3      // max new entries per scan cycle

export async function runSwingStrategy(
  alpaca:          AlpacaClient,
  budget:          number,
  currentExposure: number,
): Promise<StrategyResult> {
  const ts = new Date().toISOString()
  if (budget === 0)
    return { signals: [], scanned: 0, errors: ['Swing budget not set'], strategy: 'swing', timestamp: ts }

  const available = Math.max(0, budget - currentExposure)
  if (available < 500)
    return { signals: [], scanned: 0, errors: ['Swing budget fully deployed'], strategy: 'swing', timestamp: ts }

  const signals: Signal[] = []
  const errors:  string[] = []

  const positions = await alpaca.getPositions().catch(() => [])
  const held      = new Set(positions.map(p => p.symbol))

  // Top 200 halal names — broadest swing universe
  const universe = HALAL_SYMBOLS.slice(0, 200)
  let scanned    = 0

  for (const symbol of universe) {
    if (signals.length >= MAX_SIGNALS) break
    if (held.has(symbol)) continue
    try {
      const bars = await alpaca.getBars(symbol, 6)   // 6 months of daily bars
      if (bars.length < ST_PERIOD + ATR_PERIOD + 10) { scanned++; continue }

      const { supertrend, direction } = calcSuperTrend(bars, ST_PERIOD, ST_MULTIPLIER)
      const atrArr = calcATR(bars, ATR_PERIOD)
      const n      = bars.length

      // Bullish crossover: was bearish on penultimate bar, bullish on latest
      if (direction[n - 2] !== -1 || direction[n - 1] !== 1) { scanned++; continue }

      const stVal   = supertrend[n - 1]
      const currATR = atrArr[atrArr.length - 1]
      if (!stVal || !currATR || isNaN(currATR)) { scanned++; continue }

      const entryPrice = +(bars[n - 1].close * 1.001).toFixed(2)   // 0.1% slippage
      const stopPrice  = +(stVal * 0.995).toFixed(2)                // 0.5% under ST line
      const risk       = entryPrice - stopPrice
      if (risk <= 0 || risk / entryPrice > 0.08) { scanned++; continue }  // skip >8% stop

      const targetPrice = +(entryPrice + 2 * currATR).toFixed(2)
      const riskDollars = budget * RISK_PCT
      const qtyByRisk   = Math.floor(riskDollars / risk)
      const qtyByCash   = Math.floor(available / entryPrice)
      const qty         = Math.min(qtyByRisk, qtyByCash)
      if (qty < 1) { scanned++; continue }

      signals.push({
        symbol, strategy: 'swing', action: 'BUY',
        price: entryPrice, stopPrice, targetPrice, qty,
        reason: `SuperTrend bullish flip | ATR=${currATR.toFixed(2)} | Stop=$${stopPrice} | R:R=1:${((targetPrice - entryPrice) / risk).toFixed(1)}`,
        timestamp: ts,
      })
      scanned++
    } catch (e) {
      errors.push(`${symbol}: ${(e as Error).message}`)
      scanned++
    }
  }

  return { signals, scanned, errors, strategy: 'swing', timestamp: ts }
}
