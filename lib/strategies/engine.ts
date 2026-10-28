/**
 * Strategy Engine Orchestrator
 *
 * Runs the three strategy modules concurrently, then places orders
 * for every signal while enforcing per-strategy dollar allocation caps.
 * Uses total portfolio market value as a shared exposure floor.
 */
import type { AlgoAllocations, StrategyResult } from './types'
import { runSwingStrategy }    from './swing'
import { runDayStrategy }      from './day-trade'
import { runLongtermStrategy } from './longterm'
import type { AlpacaClient }   from '@/lib/alpaca'

export async function runAllStrategies(
  alpaca:      AlpacaClient,
  allocations: AlgoAllocations,
  opts: { runDay?: boolean; runSwing?: boolean; runLongterm?: boolean } = {},
): Promise<{ results: StrategyResult[]; ordersPlaced: number; errors: string[] }> {
  const { runDay = true, runSwing = true, runLongterm = false } = opts
  const errors: string[] = []
  let ordersPlaced = 0

  // Total current portfolio exposure across all positions
  const positions     = await alpaca.getPositions().catch(() => [])
  const totalExposure = positions.reduce((s, p) => s + p.marketValue, 0)

  // Run all active strategies concurrently
  const tasks: Promise<StrategyResult>[] = []
  if (runDay)      tasks.push(runDayStrategy(alpaca,      allocations.dayBudget,      totalExposure))
  if (runSwing)    tasks.push(runSwingStrategy(alpaca,    allocations.swingBudget,    totalExposure))
  if (runLongterm) tasks.push(runLongtermStrategy(alpaca, allocations.longtermBudget, totalExposure))

  const settled = await Promise.allSettled(tasks)
  const results: StrategyResult[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') results.push(s.value)
    else errors.push((s.reason as Error).message)
  }

  // Place orders — enforce per-bucket budget cap
  for (const result of results) {
    const budget = result.strategy === 'day'      ? allocations.dayBudget
                 : result.strategy === 'swing'     ? allocations.swingBudget
                 : allocations.longtermBudget

    const prefix = result.strategy === 'day'      ? 'DAY'
                 : result.strategy === 'swing'     ? 'SWING' : 'LT'

    let spent = 0

    for (const signal of result.signals) {
      const cost = signal.price * signal.qty
      if (spent + cost > budget) {
        errors.push(`${signal.symbol}: skipped — would exceed ${prefix} budget ($${budget.toLocaleString()})`)
        continue
      }

      const order = await alpaca.placeOrder({
        symbol:      signal.symbol,
        qty:         signal.qty,
        side:        signal.action === 'BUY' ? 'buy' : 'sell',
        limitPrice:  signal.action === 'BUY' && signal.price > 0 ? signal.price : undefined,
        stopPrice:   signal.stopPrice   > 0 ? signal.stopPrice   : undefined,
        targetPrice: signal.targetPrice > 0 ? signal.targetPrice : undefined,
        strategy:    prefix,
      })

      if (order.ok) {
        spent += cost
        ordersPlaced++
        console.log(
          `[ALGO] ${prefix} ${signal.action} ${signal.qty}×${signal.symbol}` +
          ` @ $${signal.price} | ${signal.reason}`
        )
      } else {
        errors.push(`${signal.symbol}: order failed — ${order.message}`)
      }
    }
  }

  return { results, ordersPlaced, errors }
}
