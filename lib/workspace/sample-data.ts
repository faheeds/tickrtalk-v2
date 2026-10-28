import type { Account, Holding, Screening, Trade } from './types'
export const sampleDate = '2026-10-13'
export const accounts: Account[] = [
  { id: 'alpaca', broker: 'Alpaca', name: 'Individual investing', lastFour: '1824', coverage: 24, balance: 48352.40, status: 'connected', execution: true },
  { id: 'schwab', broker: 'Schwab', name: 'Long-term portfolio', lastFour: '4092', coverage: 18, balance: 31284.50, status: 'connected', execution: false },
]
export const holdings: Holding[] = [
  { symbol: 'AAPL', name: 'Apple', account: 'alpaca', broker: 'Alpaca', quantity: 10, cost: 180, price: 243.20, color: '#cbd5e1', screening: 'pass' },
  { symbol: 'MSFT', name: 'Microsoft', account: 'schwab', broker: 'Schwab', quantity: 5, cost: 415.10, price: 515.10, color: '#7fb6ef', screening: 'review' },
  { symbol: 'JPM', name: 'JPMorgan Chase', account: 'alpaca', broker: 'Alpaca', quantity: 8, cost: 200, price: 182.40, color: '#b4b6df', screening: 'fail' },
  { symbol: 'NVDA', name: 'NVIDIA', account: 'schwab', broker: 'Schwab', quantity: 15, cost: 175, price: 181.02, color: '#84cba0', screening: 'pass' },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', account: 'schwab', broker: 'Schwab', quantity: 6, cost: null, price: 574.36, color: '#dfa18f', screening: 'unavailable' },
]
export const trades: Trade[] = [
  { id: 'tt-1061', symbol: 'AAPL', name: 'Apple', account: 'alpaca', broker: 'Alpaca', date: '2026-10-12T14:24:00Z', side: 'Sell', quantity: 5, price: 229.14, pnl: 284.50, style: 'swing', mode: 'real', status: 'Filled', origin: 'algo' },
  { id: 'tt-1060', symbol: 'MSFT', name: 'Microsoft', account: 'schwab', broker: 'Schwab', date: '2026-10-09T15:41:00Z', side: 'Sell', quantity: 5, price: 505.21, pnl: -126.40, style: 'swing', mode: 'real', status: 'Filled', origin: 'manual' },
  { id: 'tt-1059', symbol: 'NVDA', name: 'NVIDIA', account: 'alpaca', broker: 'Alpaca', date: '2026-10-08T17:12:00Z', side: 'Sell', quantity: 8, price: 181.02, pnl: 392.10, style: 'day', mode: 'real', status: 'Filled', origin: 'algo' },
  { id: 'tt-1058', symbol: 'AAPL', name: 'Apple', account: 'alpaca', broker: 'Alpaca', date: '2026-09-24T14:32:00Z', side: 'Buy', quantity: 10, price: 223.54, pnl: null, style: 'longterm', mode: 'real', status: 'Filled', origin: 'manual' },
  { id: 'tt-p1061', symbol: 'AAPL', name: 'Apple', account: 'alpaca', broker: 'Alpaca', date: '2026-10-12T14:24:00Z', side: 'Sell', quantity: 5, price: 229.14, pnl: 142.25, style: 'swing', mode: 'paper', status: 'Filled', origin: 'algo' },
  { id: 'tt-p1060', symbol: 'MSFT', name: 'Microsoft', account: 'alpaca', broker: 'Alpaca', date: '2026-10-09T15:41:00Z', side: 'Buy', quantity: 10, price: 505.21, pnl: null, style: 'swing', mode: 'paper', status: 'Filled', origin: 'algo' },
  { id: 'tt-p1059', symbol: 'NVDA', name: 'NVIDIA', account: 'alpaca', broker: 'Alpaca', date: '2026-10-08T17:12:00Z', side: 'Sell', quantity: 8, price: 181.02, pnl: -42.80, style: 'day', mode: 'paper', status: 'Filled', origin: 'algo' },
  { id: 'tt-p1058', symbol: 'AAPL', name: 'Apple', account: 'alpaca', broker: 'Alpaca', date: '2026-10-02T14:32:00Z', side: 'Buy', quantity: 15, price: 218.54, pnl: null, style: 'longterm', mode: 'paper', status: 'Filled', origin: 'algo' },
]
export const portfolioSeries = [0, 850, 1120, 440, -520, 280, 1940, 3120, 2780, 3860, 5120, 4670, 6290, 7100, 6340, 8270, 7690, 9230, 10800, 9810, 11710, 10490, 12870, 13910, 12480.36]
export const monthlyPnl = portfolioSeries.slice(1).map((v, i) => Number((v - portfolioSeries[i]).toFixed(2)))
const ratio = (key: string, label: string, value: number | null, threshold: number, status: Screening['status']) => ({ key, label, value, threshold, status })
export function sampleScreen(symbol: string): Screening | null {
  const stock = holdings.find(h => h.symbol === symbol)
  if (!stock) return null
  const status = stock.screening
  return {
    ticker: symbol, status, verdict: status === 'pass' ? 'Likely Compliant' : status === 'review' ? 'Review Needed' : status === 'fail' ? 'Non-Compliant' : 'Not screened',
    reason: status === 'pass' ? 'The available business activity and financial checks support this screening result.' : status === 'review' ? 'The reported business segments do not provide enough detail to resolve the activity assessment.' : status === 'fail' ? 'The sample business activity assessment does not pass the configured screening criteria.' : 'This service screens individual companies. Funds and ETFs are not screened directly.',
    asOf: '2026-10-13T16:30:00Z', period: 'Sample financial period', cached: true,
    qualification: symbol === 'AAPL' ? 'The income test could not be verified.' : undefined,
    ratios: status === 'unavailable' ? [] : [ratio('debt', 'Debt / market capitalization', .124, .30, 'pass'), ratio('liquidity', 'Liquidity / market capitalization', .081, .30, 'pass'), ratio('income', 'Impermissible income / revenue', symbol === 'AAPL' ? null : .018, .05, symbol === 'AAPL' ? 'review' : 'pass')],
  }
}
