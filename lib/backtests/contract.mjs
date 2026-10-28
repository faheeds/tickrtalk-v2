const symbolPattern = /^[A-Z][A-Z0-9.-]{0,9}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

export const VIBE_BACKTEST_VERSION = '0.1.18'
export const VIBE_BACKTEST_REPOSITORY = 'https://github.com/HKUDS/Vibe-Trading'
export const TERMINAL_BACKTEST_STATES = new Set(['completed', 'failed', 'cancelled'])

export function validateBacktestRequest(input, sp500Symbols = [], now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('Choose a backtest setup.')
  const strategyNames = {
    moving_average_trend: 'Moving average trend',
    momentum_confirmation: 'Momentum confirmation',
    bollinger_pullback: 'Bollinger pullback',
    donchian_breakout: 'Donchian breakout',
  }
  if (!Object.hasOwn(strategyNames, input.strategy)) throw badRequest('Choose a supported research strategy.')
  const capital = Number(input.initialCapital)
  if (!Number.isFinite(capital) || capital < 100 || capital > 10000000) throw badRequest('Use a starting balance between $100 and $10,000,000.')
  const fast = Number(input.fastWindow)
  const slow = Number(input.slowWindow)
  if (!Number.isInteger(fast) || fast < 5 || fast > 100 || !Number.isInteger(slow) || slow < 20 || slow > 250 || fast >= slow) {
    throw badRequest('The short window must be 5 to 100 sessions and shorter than a 20 to 250 session long window.')
  }
  if (!['sip', 'iex'].includes(input.feed)) throw badRequest('Choose a supported Alpaca market data feed.')
  if (!datePattern.test(input.startDate) || !validDate(input.startDate) || !datePattern.test(input.endDate) || !validDate(input.endDate)) {
    throw badRequest('Enter valid start and end dates.')
  }
  if (input.startDate >= input.endDate || input.endDate > now.toISOString().slice(0, 10)) throw badRequest('The end date must be today or earlier and after the start date.')
  const years = (Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86400000 / 365.25
  if (years > 5) throw badRequest('Backtests can cover up to 5 years at a time.')

  let symbols
  if (input.universe === 'sp500') {
    symbols = [...new Set(sp500Symbols.filter(symbol => typeof symbol === 'string' && symbolPattern.test(symbol.toUpperCase())).map(symbol => symbol.toUpperCase()))]
  } else if (input.universe === 'custom') {
    if (typeof input.symbols !== 'string' || input.symbols.length > 8000) throw badRequest('Enter up to 500 comma or space separated stock symbols.')
    const entered = input.symbols.split(/[\s,]+/).filter(Boolean).map(symbol => symbol.toUpperCase())
    if (entered.length > 500 || entered.some(symbol => !symbolPattern.test(symbol))) throw badRequest('Enter up to 500 valid US stock symbols.')
    symbols = [...new Set(entered)]
  } else {
    throw badRequest('Choose the S&P 500 or enter a custom stock list.')
  }
  if (!symbols.length) throw badRequest('Add at least one stock symbol.')
  if (symbols.length > 503) throw badRequest('This universe contains too many symbols.')

  return Object.freeze({
    strategy: input.strategy,
    strategyName: strategyNames[input.strategy],
    fastWindow: fast,
    slowWindow: slow,
    initialCapital: capital,
    feed: input.feed,
    universe: input.universe,
    symbols,
    startDate: input.startDate,
    endDate: input.endDate,
    market: 'US stocks',
    direction: 'long only',
    leverage: 1,
    assetTypes: ['common stocks'],
  })
}

export function publicBacktestJob(row, detail = false) {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    request: row.request,
    error: row.error,
    ...(detail ? {result: row.result} : {}),
  }
}

function validDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function badRequest(message) {
  return Object.assign(new Error(message), {status: 400})
}
