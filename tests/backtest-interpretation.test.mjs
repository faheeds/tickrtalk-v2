import test from 'node:test'
import assert from 'node:assert/strict'
import {annualizedReturnDecimal, interpretBacktest} from '../lib/backtests/interpretation.mjs'

test('backtest interpretation identifies a preliminary positive research signal without calling it live-ready', () => {
  const report = interpretBacktest({
    metrics: {total_return: 0.24, annualized_return: 0.11, max_drawdown: 0.12, sharpe_ratio: 1.3, trade_count: 40},
    trades: Array.from({length: 40}, (_, index) => ({pnl: index % 3 ? 25 : -15})),
    validation: {
      monte_carlo: {p_value_sharpe: 0.02},
      bootstrap: {ci_lower: 0.2, ci_upper: 1.8},
      walk_forward: {consistency_rate: 0.8},
    },
    warnings: ['Costs are simplified.'],
  })
  assert.equal(report.verdict, 'Promising for further research')
  assert.match(report.rationale, /not a signal to trade it live/)
  assert.ok(report.caveats.includes('Costs are simplified.'))
})

test('backtest interpretation rejects negative historical returns and calls out a thin sample', () => {
  const report = interpretBacktest({metrics: {total_return: -0.08, max_drawdown: 0.3, sharpe_ratio: -0.4}, trades: [{pnl: -4}]})
  assert.equal(report.verdict, 'Not supported by this sample')
  assert.match(report.rationale, /did not make money/)
  assert.ok(report.caveats.some(item => /Fewer than 30 trades/.test(item)))
})

test('missing risk and return metrics lead to mixed evidence rather than an invented recommendation', () => {
  const report = interpretBacktest({metrics: {}, trades: []})
  assert.equal(report.verdict, 'Mixed evidence')
  assert.equal(report.evidence.length, 0)
  assert.ok(report.caveats.some(item => /Maximum drawdown was unavailable/.test(item)))
})

test('annualized return is derived from cumulative return and the tested dates when the engine omits it', () => {
  const result = {
    metrics: {total_return: 0.2794, sharpe: 0.95},
    request: {startDate: '2024-10-26', endDate: '2026-10-27'},
  }
  assert.ok(Math.abs(annualizedReturnDecimal(result) - 0.1308) < 0.001)
  const report = interpretBacktest(result)
  assert.ok(report.evidence.some(item => /Annualized return was 13\.1%/.test(item)))
})

test('reported annualized return takes precedence and invalid dates do not produce a derived value', () => {
  assert.equal(annualizedReturnDecimal({metrics: {annualized_return: 0.12, total_return: 0.4}, request: {startDate: '2024-01-01', endDate: '2025-01-01'}}), 0.12)
  assert.equal(annualizedReturnDecimal({metrics: {total_return: 0.4}, request: {startDate: 'invalid', endDate: '2025-01-01'}}), null)
})

test('missing or weak statistical validation prevents a positive research recommendation', () => {
  const report = interpretBacktest({
    metrics: {total_return: 0.24, max_drawdown: 0.12, sharpe_ratio: 1.3, trade_count: 40},
    trades: Array.from({length: 40}, (_, index) => ({pnl: index % 3 ? 25 : -15})),
    validation: {
      monte_carlo: {p_value_sharpe: 0.08},
      bootstrap: {ci_lower: 0.2, ci_upper: 1.8},
      walk_forward: {consistency_rate: 0.8},
    },
  })
  assert.equal(report.verdict, 'Mixed evidence')
  assert.ok(report.caveats.some(item => /did not meet the preliminary 0.05 threshold/.test(item)))
})
