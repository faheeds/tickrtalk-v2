export function unrealized(holding) {
  if (holding.cost == null || !Number.isFinite(holding.cost)) return null
  return (holding.price - holding.cost) * holding.quantity
}
export function summarizeHoldings(holdings) {
  if(new Set(holdings.map(h=>h.currency??'USD')).size>1)throw new Error('Choose one currency before calculating portfolio totals.')
  const known = holdings.filter(h => unrealized(h) !== null)
  return { value: holdings.reduce((sum, h) => sum + h.quantity * h.price, 0), unrealized: known.reduce((sum, h) => sum + unrealized(h), 0), incomplete: known.length !== holdings.length }
}
export function screeningCounts(holdings, results) {
  return holdings.reduce((counts, h) => { const status = results[h.symbol]?.status ?? 'unavailable'; counts[status]++; return counts }, { pass: 0, review: 0, fail: 0, unavailable: 0 })
}
export function filledTransactions(trades, mode, style) {
  return trades.filter(t => t.origin === 'algo' && t.mode === mode && t.style === style && (t.status === 'Filled' || t.status === 'Partially filled'))
}
export function chunkSymbols(symbols, size = 50) {
  const unique = [...new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))]
  return Array.from({ length: Math.ceil(unique.length / size) }, (_, i) => unique.slice(i * size, (i + 1) * size))
}
export function matchFills(fills) {
  const lots = new Map()
  return [...fills].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(fill => {
    const key = `${fill.account}:${fill.currency??'USD'}:${fill.symbol}`
    if (!lots.has(key)) lots.set(key, [])
    const queue = lots.get(key)
    if (fill.side === 'Buy') { queue.push({ quantity: fill.quantity, price: fill.price }); return { ...fill, pnl: null } }
    let remaining = fill.quantity, cost = 0
    while (remaining > 1e-8 && queue.length) {
      const lot = queue[0], amount = Math.min(remaining, lot.quantity)
      cost += amount * lot.price; remaining -= amount; lot.quantity -= amount
      if (lot.quantity <= 1e-8) queue.shift()
    }
    return { ...fill, pnl: remaining > 1e-8 ? null : Number((fill.price * fill.quantity - cost).toFixed(2)), basisIncomplete: remaining > 1e-8 }
  })
}
