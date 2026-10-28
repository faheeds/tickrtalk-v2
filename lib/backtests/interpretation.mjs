const metric = (metrics, ...keys) => {
  for (const key of keys) {
    if (metrics?.[key] === null || metrics?.[key] === undefined || metrics?.[key] === '') continue
    const value = Number(metrics?.[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

const percentage = value => value === null ? null : Math.abs(value) <= 1 ? value * 100 : value

export function annualizedReturnDecimal(result = {}) {
  const metrics = result.metrics ?? {}
  const reported = metric(metrics, 'annualized_return', 'annualizedReturn', 'annual_return_pct')
  if (reported !== null) return Math.abs(reported) <= 1 ? reported : reported / 100

  const totalReturn = metric(metrics, 'total_return', 'totalReturn', 'return_pct', 'returnPct')
  const start = Date.parse(result.request?.startDate)
  const end = Date.parse(result.request?.endDate)
  if (totalReturn === null || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null

  const totalReturnDecimal = Math.abs(totalReturn) <= 1 ? totalReturn : totalReturn / 100
  if (totalReturnDecimal <= -1) return null
  const days = (end - start) / 86400000
  const annualized = (1 + totalReturnDecimal) ** (365.25 / days) - 1
  return Number.isFinite(annualized) ? annualized : null
}

export function interpretBacktest(result = {}) {
  const metrics = result.metrics ?? {}
  const totalReturn = percentage(metric(metrics, 'total_return', 'totalReturn', 'return_pct', 'returnPct'))
  const annualizedValue = annualizedReturnDecimal(result)
  const annualizedReturn = annualizedValue === null ? null : annualizedValue * 100
  const drawdownValue = metric(metrics, 'max_drawdown', 'maxDrawdown', 'maximum_drawdown', 'maximumDrawdown')
  const maxDrawdown = drawdownValue === null ? null : Math.abs(percentage(drawdownValue))
  const sharpe = metric(metrics, 'sharpe_ratio', 'sharpeRatio', 'sharpe')
  const trades = (Array.isArray(result.trades) ? result.trades : [])
    .map(trade => Number(trade.pnl ?? trade.profit_loss ?? trade.profitLoss))
    .filter(Number.isFinite)
  const winners = trades.filter(pnl => pnl > 0).length
  const losers = trades.filter(pnl => pnl < 0)
  const grossProfit = trades.filter(pnl => pnl > 0).reduce((sum, pnl) => sum + pnl, 0)
  const grossLoss = Math.abs(losers.reduce((sum, pnl) => sum + pnl, 0))
  const tradeCount = Number.isFinite(Number(metrics.trade_count ?? metrics.tradeCount))
    ? Number(metrics.trade_count ?? metrics.tradeCount)
    : trades.length
  const profitFactor = metric(metrics, 'profit_factor', 'profitFactor') ?? (grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null)
  const winRate = tradeCount > 0 && trades.length > 0 ? winners / trades.length * 100 : percentage(metric(metrics, 'win_rate', 'winRate'))
  const requested = result.coverage?.requested?.length
  const included = result.coverage?.included?.length
  const incompleteCoverage = Number.isFinite(requested) && Number.isFinite(included) && included < requested
  const validation = result.validation ?? {}
  const monteCarlo = validation.monte_carlo ?? {}
  const bootstrap = validation.bootstrap ?? {}
  const walkForward = validation.walk_forward ?? {}
  const permutationP = metric(monteCarlo, 'p_value_sharpe')
  const bootstrapLower = metric(bootstrap, 'ci_lower')
  const bootstrapUpper = metric(bootstrap, 'ci_upper')
  const consistencyRate = percentage(metric(walkForward, 'consistency_rate'))
  const validationChecks = [permutationP, bootstrapLower, consistencyRate]
  const validationComplete = validationChecks.every(value => value !== null)
  const validationPassed = validationComplete && permutationP <= 0.05 && bootstrapLower > 0 && consistencyRate >= 60

  const evidence = []
  if (totalReturn !== null) evidence.push(totalReturn > 0 ? `The backtest returned ${totalReturn.toFixed(1)}% before any costs the engine did not model.` : `The backtest returned ${totalReturn.toFixed(1)}%, which is not positive.`)
  if (annualizedReturn !== null) evidence.push(`Annualized return was ${annualizedReturn.toFixed(1)}%.`)
  if (maxDrawdown !== null) evidence.push(`The largest reported drawdown was ${maxDrawdown.toFixed(1)}%.`)
  if (sharpe !== null) evidence.push(`Sharpe ratio was ${sharpe.toFixed(2)}.`)
  if (tradeCount > 0) evidence.push(`${tradeCount} trades were reported${winRate !== null ? `, with a ${winRate.toFixed(1)}% win rate` : ''}${profitFactor !== null && Number.isFinite(profitFactor) ? ` and a ${profitFactor.toFixed(2)} profit factor` : ''}.`)
  if (permutationP !== null) evidence.push(`Randomized-trade check: ${permutationP.toFixed(3)} of shuffled paths matched or exceeded the observed Sharpe; lower is more favorable in this check.`)
  if (bootstrapLower !== null) evidence.push(`Bootstrap Sharpe interval: ${bootstrapLower.toFixed(2)}${bootstrapUpper !== null ? ` to ${bootstrapUpper.toFixed(2)}` : ''}. A lower bound above zero is a stronger signal.`)
  if (consistencyRate !== null) evidence.push(`Walk-forward profitability: ${consistencyRate.toFixed(0)}% of time windows were profitable.`)

  let verdict = 'Mixed evidence'
  let rationale = 'The available results do not meet the research screen for a stronger signal. Review the trade sample, costs, and robustness checks before drawing a conclusion.'
  if (totalReturn !== null && totalReturn <= 0) {
    verdict = 'Not supported by this sample'
    rationale = 'The strategy did not make money over this test period. Do not advance it on this result alone.'
  } else if (profitFactor !== null && profitFactor < 1) {
    verdict = 'Not supported by this sample'
    rationale = 'Reported losing trades outweighed winning trades. Do not advance it on this result alone.'
  } else if (totalReturn !== null && totalReturn > 0 && sharpe !== null && sharpe >= 1 && maxDrawdown !== null && maxDrawdown <= 20 && tradeCount >= 30 && profitFactor !== null && profitFactor >= 1.2 && validationPassed) {
    verdict = 'Promising for further research'
    rationale = 'Return, risk, sample size, and the available statistical checks pass this preliminary screen. This is a reason to continue paper testing, not a signal to trade it live.'
  }

  const caveats = []
  if (tradeCount < 30) caveats.push('Fewer than 30 trades: the sample is too small for a dependable conclusion.')
  if (sharpe === null) caveats.push('No Sharpe ratio was available to assess return relative to volatility.')
  if (maxDrawdown === null) caveats.push('Maximum drawdown was unavailable, so downside risk could not be screened.')
  if (profitFactor === null) caveats.push('Trade-level profit factor was unavailable, so wins and losses could not be compared.')
  if (permutationP === null) caveats.push('The randomized-trade validation result was unavailable.')
  else if (permutationP > 0.05) caveats.push('The randomized-trade check did not meet the preliminary 0.05 threshold.')
  if (bootstrapLower === null) caveats.push('The bootstrap Sharpe confidence interval was unavailable.')
  else if (bootstrapLower <= 0) caveats.push('The bootstrap Sharpe lower bound was not above zero, so positive risk-adjusted performance is not yet robust in this check.')
  if (consistencyRate === null) caveats.push('Walk-forward consistency was unavailable.')
  else if (consistencyRate < 60) caveats.push('Fewer than 60% of walk-forward windows were profitable.')
  if (incompleteCoverage) caveats.push(`Only ${included} of ${requested} requested symbols had usable history.`)
  for (const warning of result.warnings ?? []) caveats.push(String(warning))
  caveats.push('These are preliminary screening thresholds, not a guarantee or a live-trading recommendation.')

  return { verdict, rationale, evidence, caveats }
}
