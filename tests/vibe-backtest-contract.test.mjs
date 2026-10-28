import test from 'node:test'
import assert from 'node:assert/strict'
import {publicBacktestJob, validateBacktestRequest, VIBE_BACKTEST_VERSION} from '../lib/backtests/contract.mjs'

const now = new Date('2026-10-26T12:00:00Z')
const request = {
  strategy: 'moving_average_trend', initialCapital: 1000, fastWindow: 20, slowWindow: 50,
  feed: 'sip', universe: 'custom', symbols: 'AAPL, MSFT', startDate: '2024-10-01', endDate: '2026-10-25',
}

test('accepts bounded cash-only stock research and canonicalizes symbols', () => {
  const result = validateBacktestRequest({...request, symbols: 'aapl MSFT,AAPL'}, [], now)
  assert.deepEqual(result.symbols, ['AAPL', 'MSFT'])
  assert.equal(result.leverage, 1)
  assert.equal(result.direction, 'long only')
  assert.equal(result.strategyName, 'Moving average trend')
})

test('accepts each supported daily strategy and returns its display name', () => {
  const strategies = [
    ['moving_average_trend', 'Moving average trend'],
    ['momentum_confirmation', 'Momentum confirmation'],
    ['bollinger_pullback', 'Bollinger pullback'],
    ['donchian_breakout', 'Donchian breakout'],
  ]
  for (const [strategy, strategyName] of strategies) {
    const result = validateBacktestRequest({...request, strategy}, [], now)
    assert.equal(result.strategy, strategy)
    assert.equal(result.strategyName, strategyName)
  }
})

test('uses the supplied S&P 500 membership snapshot', () => {
  const result = validateBacktestRequest({...request, universe: 'sp500', symbols: ''}, ['AAPL', 'BRK.B', 'BAD SYMBOL'], now)
  assert.deepEqual(result.symbols, ['AAPL', 'BRK.B'])
})

test('rejects invalid strategy, leverage-shaped values, invalid dates, and oversized symbol lists', () => {
  assert.throws(() => validateBacktestRequest({...request, strategy: 'options'}, [], now), /supported research strategy/)
  assert.throws(() => validateBacktestRequest({...request, initialCapital: 0}, [], now), /starting balance/)
  assert.throws(() => validateBacktestRequest({...request, fastWindow: 80, slowWindow: 50}, [], now), /short window/)
  assert.throws(() => validateBacktestRequest({...request, endDate: '2026-10-27'}, [], now), /today or earlier/)
  assert.throws(() => validateBacktestRequest({...request, startDate: '2020-01-01'}, [], now), /up to 5 years/)
  assert.throws(() => validateBacktestRequest({...request, symbols: Array(501).fill('AAPL').join(',')}, [], now), /up to 500/)
})

test('keeps result payload private until a detail request and pins the upstream version', () => {
  const row = {id: 'run', status: 'completed', stage: 'Ready', created_at: 'now', updated_at: 'now', request, result: {secret: false}, error: null}
  assert.equal('result' in publicBacktestJob(row), false)
  assert.deepEqual(publicBacktestJob(row, true).result, row.result)
  assert.equal(VIBE_BACKTEST_VERSION, '0.1.18')
})
