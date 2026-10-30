// Tests for lib/blend-runner.ts using a fake broker and an in-memory ledger.  Run: npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// Let plain Node resolve the repo's extensionless TypeScript imports, as Next's bundler does.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try { return await next(specifier, context) }
  catch (e) {
    if (e && e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context)
    throw e
  }
}`), import.meta.url)

const { runBlend, etNow, reconcile, clientOrderId } = await import('../lib/blend-runner.ts')
const { BLEND_UNIVERSE, sizeQty } = await import('../lib/strategies/blend-core.ts')

const TODAY = '2026-10-29'                       // Thursday; the run happens at ~10:00 ET
const NOW = new Date('2026-10-29T14:00:00Z')

// ── fixtures ────────────────────────────────────────────────────────────────
function weekdaysBack(endISO, n) {
  const out = []; const d = new Date(endISO + 'T04:00:00Z')
  while (out.length < n) { if (d.getUTCDay() % 6 !== 0) out.unshift(new Date(d)); d.setUTCDate(d.getUTCDate() - 1) }
  return out
}
function risingBars(endISO, k, n = 330) {
  return weekdaysBack(endISO, n).map((date, t) => {
    const c = 100 * Math.pow(1.0006, t) * (1 + 0.004 * Math.sin(0.7 * t + k))
    return { date, open: c, high: c * 1.005, low: c * 0.995, close: c }
  })
}
function withDip(bars) {            // last three closes fall 1% each: a 3-day dip in an uptrend
  const out = bars.map(b => ({ ...b })), n = out.length
  for (let i = 1; i <= 3; i++) { const c = out[n - 4].close * (1 - 0.01 * i); out[n - 4 + i] = { ...out[n - 4 + i], open: c, high: c * 1.005, low: c * 0.995, close: c } }
  return out
}
function withBounce(bars) {         // last close jumps 15%: above the 5-day average
  const out = bars.map(b => ({ ...b })), n = out.length
  const c = out[n - 1].close * 1.15
  out[n - 1] = { ...out[n - 1], close: c, high: c * 1.01 }
  return out
}

function world({ end = '2026-10-28', dipSymbols = [], bounceSymbols = [], missing = [], cash = 500_000, clockOpen = true, sipFails = [] } = {}) {
  const data = new Map()
  ;['SPY', ...BLEND_UNIVERSE].forEach((s, i) => {
    if (missing.includes(s)) return
    let b = risingBars(end, i)
    if (dipSymbols.includes(s)) b = withDip(b)
    if (bounceSymbols.includes(s)) b = withBounce(b)
    data.set(s, b)
  })
  const orders = new Map()                         // client id -> order
  const calls = []
  const broker = {
    async getClock() { calls.push('clock'); return { isOpen: clockOpen } },
    async getCalendar(from, to) { return weekdaysBack(to, 8).map(d => ({ date: d.toISOString().slice(0, 10) })).filter(x => x.date >= from) },
    async getBars(sym, _m, _tf, opts) { if (opts.feed === 'sip' && sipFails.includes(sym)) return []; return data.get(sym) ?? [] },
    async getAccount() { return { cash, buyingPower: cash } },
    async placeOrder(o) {
      calls.push(`order:${o.side}:${o.symbol}`)
      if (orders.has(o.clientOrderId)) return { ok: false, message: 'client_order_id must be unique' }
      if (broker.rejectBuys?.includes(o.symbol) && o.side === 'buy') return { ok: false, message: 'insufficient buying power' }
      orders.set(o.clientOrderId, { ...o, status: 'accepted', filledQty: 0, filledAvgPrice: null })
      return { ok: true }
    },
    async getOrderByClientId(id) { const o = orders.get(id); return o ? { status: o.status, filledQty: o.filledQty, filledAvgPrice: o.filledAvgPrice } : null },
    fill(id, price) { const o = orders.get(id); o.status = 'filled'; o.filledQty = o.qty; o.filledAvgPrice = price },
  }
  return { broker, orders, calls, data }
}

function memStore(calls = []) {
  const rows = []; let seq = 0
  return {
    rows, month: null,
    async listLive() { return rows.filter(r => ['pending_entry', 'open', 'pending_exit'].includes(r.status)).map(r => ({ ...r })) },
    async insertEntry(e) {
      if (rows.some(r => r.sleeve === e.sleeve && r.symbol === e.symbol && ['pending_entry', 'open', 'pending_exit'].includes(r.status))) return { ok: false, message: 'already open or ordered' }
      calls.push(`ledger:${e.symbol}`)
      const row = { id: `r${++seq}`, status: 'pending_entry', qty: 0, entry_price: null, exit_client_id: null, ...e }; rows.push(row); return { ok: true, id: row.id }
    },
    async update(id, patch) { Object.assign(rows.find(r => r.id === id), patch) },
    async setLastRebalanceMonth(m) { this.month = m },
  }
}

const opts = (w, store, over = {}) => ({ broker: w.broker, store, isHalal: () => true, now: NOW, budget: 100_000, allowEntries: true, dryRun: false, paper: true, ...over })

// ── safety gates ────────────────────────────────────────────────────────────

test('refuses a live-money connection and touches nothing', async () => {
  const w = world({ dipSymbols: ['AAPL'] }); const st = memStore()
  const r = await runBlend(opts(w, st, { paper: false }))
  assert.equal(r.status, 'skipped'); assert.match(r.message, /paper/i)
  assert.deepEqual(w.calls, []); assert.equal(st.rows.length, 0)
})

test('paper flag must be exactly true (undefined/null are refused)', async () => {
  for (const paper of [undefined, null, 'true', 1]) {
    const w = world(); const r = await runBlend(opts(w, memStore(), { paper }))
    assert.equal(r.status, 'skipped'); assert.deepEqual(w.calls, [])
  }
})

test('no budget, or a budget below the minimum, means no run', async () => {
  for (const budget of [0, 5_000, NaN]) { const w = world(); assert.equal((await runBlend(opts(w, memStore(), { budget }))).status, 'skipped') }
})

test('market closed: skipped, no orders', async () => {
  const w = world({ dipSymbols: ['AAPL'], clockOpen: false }); const st = memStore()
  const r = await runBlend(opts(w, st)); assert.equal(r.status, 'skipped'); assert.equal(st.rows.length, 0)
})

test('stale data aborts the run instead of trading on it', async () => {
  const w = world({ end: '2026-10-27', dipSymbols: ['AAPL'] }); const st = memStore()      // latest bar is 2 sessions old
  const r = await runBlend(opts(w, st)); assert.equal(r.status, 'failed'); assert.match(r.message, /stale/i)
  assert.equal(st.rows.length, 0); assert.ok(!w.calls.some(c => c.startsWith('order')))
})

test('thin data coverage aborts the run', async () => {
  const w = world({ missing: BLEND_UNIVERSE.slice(0, 40) }); const st = memStore()
  const r = await runBlend(opts(w, st)); assert.equal(r.status, 'failed'); assert.match(r.message, /usable data/i)
})

test('falls back to the IEX feed per symbol when SIP returns nothing, and reports it', async () => {
  const w = world({ sipFails: ['AAPL', 'MSFT'] })
  const r = await runBlend(opts(w, memStore(), { dryRun: true }))
  assert.equal(r.status, 'done'); assert.equal(r.feed.iex, 2); assert.ok(r.feed.sip > 80)
})

// ── dry run ─────────────────────────────────────────────────────────────────

test('dry run reports planned orders with sizes but places and records nothing', async () => {
  const w = world({ dipSymbols: ['AAPL'], clockOpen: false }); const st = memStore()
  const r = await runBlend(opts(w, st, { dryRun: true, ignoreClock: true }))
  assert.equal(r.status, 'done'); assert.equal(r.dryRun, true)
  const buy = r.orders.find(o => o.symbol === 'AAPL' && o.sleeve === 'down3')
  assert.ok(buy, 'AAPL 3-day dip should be planned'); assert.equal(buy.status, 'planned'); assert.equal(buy.qty, sizeQty(100_000, 'down3', buy.refPrice))
  assert.equal(st.rows.length, 0); assert.ok(!w.calls.some(c => c.startsWith('order')))
  assert.equal(r.dataBar, '2026-10-28')
})

// ── entries ─────────────────────────────────────────────────────────────────

test('entry: ledger row is written BEFORE the order is sent, with a deterministic client id', async () => {
  const calls = []; const w = world({ dipSymbols: ['AAPL'] }); w.calls = calls; w.broker.placeOrder = (orig => async o => { calls.push(`order:${o.side}:${o.symbol}`); return orig(o) })(w.broker.placeOrder)
  const st = memStore(calls)
  const r = await runBlend(opts(w, st))
  assert.equal(r.status, 'done')
  const li = calls.indexOf('ledger:AAPL'), oi = calls.findIndex(c => c === 'order:buy:AAPL')
  assert.ok(li >= 0 && oi > li, `ledger before order: ${calls.join(',')}`)
  const row = st.rows.find(x => x.symbol === 'AAPL' && x.sleeve === 'down3')
  assert.equal(row.entry_client_id, clientOrderId(TODAY, 'down3', 'AAPL', 'buy'))
  assert.match(row.entry_client_id, /^tickrtalk_BLEND_2026-10-29_down3_AAPL_B$/); assert.ok(!row.entry_client_id.includes('_DAY_'))
  assert.equal(row.status, 'pending_entry'); assert.equal(row.target_qty, sizeQty(100_000, 'down3', row.ref_price))
})

test('running twice the same day never double-buys', async () => {
  const w = world({ dipSymbols: ['AAPL', 'MSFT'] }); const st = memStore()
  const a = await runBlend(opts(w, st)); const placed1 = w.calls.filter(c => c.startsWith('order')).length
  const b = await runBlend(opts(w, st))
  assert.ok(placed1 > 0); assert.equal(w.calls.filter(c => c.startsWith('order')).length, placed1, 'second run adds no orders')
  assert.equal(b.orders.filter(o => o.status === 'placed').length, 0)
  assert.equal(new Set(st.rows.map(r => `${r.sleeve}|${r.symbol}`)).size, st.rows.length, 'no duplicate ledger rows')
})

test('a rejected buy cancels its ledger row, records the error and does not stop other orders', async () => {
  const w = world({ dipSymbols: ['AAPL', 'MSFT'] }); w.broker.rejectBuys = ['AAPL']; const st = memStore()
  const r = await runBlend(opts(w, st))
  assert.ok(r.errors.some(e => e.includes('AAPL')))
  assert.ok(st.rows.filter(x => x.symbol === 'AAPL').every(x => x.status === 'cancelled'))
  assert.ok(st.rows.some(x => x.symbol === 'MSFT' && x.status === 'pending_entry'), 'MSFT still ordered')
})

test('not enough cash: skips the entry, never sends an unfunded order', async () => {
  const w = world({ dipSymbols: ['AAPL'], cash: 10 }); const st = memStore()
  const r = await runBlend(opts(w, st))
  assert.ok(r.orders.some(o => o.status === 'skipped' && /cash/i.test(o.detail))); assert.ok(!w.calls.some(c => c.startsWith('order')))
  assert.equal(st.rows.length, 0)
})

test('paused strategy (allowEntries=false) places no buys', async () => {
  const w = world({ dipSymbols: ['AAPL'] }); const st = memStore()
  const r = await runBlend(opts(w, st, { allowEntries: false }))
  assert.equal(r.orders.filter(o => o.side === 'buy').length, 0); assert.match(r.message, /paused/i); assert.equal(st.rows.length, 0)
})

// ── reconcile, exits ────────────────────────────────────────────────────────

test('next morning: a filled entry becomes an open position with the real fill price and quantity', async () => {
  const w = world({ dipSymbols: ['AAPL'] }); const st = memStore()
  await runBlend(opts(w, st))
  const row = st.rows.find(x => x.symbol === 'AAPL' && x.sleeve === 'down3')
  w.broker.fill(row.entry_client_id, 187.25)
  const changed = await reconcile(w.broker, st, await st.listLive(), '2026-10-30')
  assert.ok(changed >= 1); assert.equal(row.status, 'open'); assert.equal(row.qty, row.target_qty); assert.equal(row.entry_price, 187.25)
})

test('an unfilled, cancelled entry is dropped from the ledger instead of being counted as held', async () => {
  const w = world({ dipSymbols: ['AAPL'] }); const st = memStore()
  await runBlend(opts(w, st))
  const row = st.rows.find(x => x.symbol === 'AAPL' && x.sleeve === 'down3'); w.orders.get(row.entry_client_id).status = 'canceled'
  await reconcile(w.broker, st, await st.listLive(), '2026-10-30'); assert.equal(row.status, 'cancelled')
})

test('exit: sells exactly the ledger quantity (not the account position) and later closes with the realised return', async () => {
  const w = world({ bounceSymbols: ['AAPL'] }); const st = memStore()
  st.rows.push({ id: 'x1', sleeve: 'down3', symbol: 'AAPL', status: 'open', target_qty: 7, qty: 7, ref_price: 150, entry_price: 150, entry_date: '2026-10-26', entry_client_id: 'e1', exit_client_id: null })
  const r = await runBlend(opts(w, st))
  const sell = r.orders.find(o => o.side === 'sell' && o.symbol === 'AAPL'); assert.ok(sell, 'bounce should trigger an exit'); assert.equal(sell.qty, 7)
  const sent = [...w.orders.values()].find(o => o.side === 'sell'); assert.equal(sent.qty, 7); assert.equal(sent.symbol, 'AAPL')
  const row = st.rows[0]; assert.equal(row.status, 'pending_exit'); assert.equal(row.exit_client_id, clientOrderId(TODAY, 'down3', 'AAPL', 'sell'))
  w.broker.fill(row.exit_client_id, 165)
  await reconcile(w.broker, st, await st.listLive(), '2026-10-30')
  assert.equal(row.status, 'closed'); assert.equal(row.exit_price, 165); assert.equal(row.return_pct, 10)
})

test('sells are sent before buys', async () => {
  const w = world({ bounceSymbols: ['AAPL'], dipSymbols: ['MSFT'] }); const st = memStore()
  st.rows.push({ id: 'x1', sleeve: 'down3', symbol: 'AAPL', status: 'open', target_qty: 5, qty: 5, ref_price: 150, entry_price: 150, entry_date: '2026-10-26', entry_client_id: 'e1', exit_client_id: null })
  await runBlend(opts(w, st))
  const seq = w.calls.filter(c => c.startsWith('order')); assert.equal(seq[0], 'order:sell:AAPL'); assert.ok(seq.slice(1).every(c => c.startsWith('order:buy')))
})

test('a holding that loses halal status is sold, whatever the signals say', async () => {
  const w = world(); const st = memStore()
  st.rows.push({ id: 'x1', sleeve: 'mom', symbol: 'NVDA', status: 'open', target_qty: 3, qty: 3, ref_price: 500, entry_price: 500, entry_date: '2026-09-01', entry_client_id: 'e1', exit_client_id: null })
  const r = await runBlend(opts(w, st, { isHalal: s => s !== 'NVDA' }))
  const sell = r.orders.find(o => o.side === 'sell'); assert.equal(sell.symbol, 'NVDA'); assert.match(sell.reason, /halal/i); assert.equal(sell.status, 'placed')
})

test('exits still run when the strategy is paused', async () => {
  const w = world({ bounceSymbols: ['AAPL'] }); const st = memStore()
  st.rows.push({ id: 'x1', sleeve: 'down3', symbol: 'AAPL', status: 'open', target_qty: 4, qty: 4, ref_price: 150, entry_price: 150, entry_date: '2026-10-26', entry_client_id: 'e1', exit_client_id: null })
  const r = await runBlend(opts(w, st, { allowEntries: false })); assert.equal(r.orders.filter(o => o.side === 'sell' && o.status === 'placed').length, 1)
})

test('month-end run records the rebalance month', async () => {
  const w = world({ end: '2026-10-30' }); const st = memStore()
  const r = await runBlend(opts(w, st, { now: new Date('2026-11-02T15:00:00Z') }))   // Monday after the last October session
  assert.equal(r.monthEnd, true); assert.equal(st.month, '2026-10')
})

// ── time zone ───────────────────────────────────────────────────────────────

test('etNow is DST-safe (cron fires at 13:35 and 14:35 UTC; only one is ~9:35 ET)', () => {
  assert.deepEqual(etNow(new Date('2026-10-29T13:35:00Z')), { date: '2026-10-29', minutes: 9 * 60 + 35 })   // EDT
  assert.deepEqual(etNow(new Date('2026-11-02T14:35:00Z')), { date: '2026-11-02', minutes: 9 * 60 + 35 })   // EST after the change
  assert.equal(etNow(new Date('2026-11-02T13:35:00Z')).minutes, 8 * 60 + 35)                               // before the window in winter
  assert.equal(etNow(new Date('2026-10-30T02:00:00Z')).date, '2026-10-29')                                 // evening ET is still the same date
})
