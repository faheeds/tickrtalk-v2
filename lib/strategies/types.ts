export type StrategyType = 'swing' | 'day' | 'longterm'

export interface Bar {
  date: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
  vwap: number | null
}

export interface Signal {
  symbol:      string
  strategy:    StrategyType
  action:      'BUY' | 'SELL'
  price:       number
  stopPrice:   number
  targetPrice: number
  qty:         number
  reason:      string
  timestamp:   string
}

export interface AlgoAllocations {
  dayBudget:      number
  swingBudget:    number
  longtermBudget: number
}

export interface StrategyResult {
  signals:   Signal[]
  scanned:   number
  errors:    string[]
  strategy:  StrategyType
  timestamp: string
}
