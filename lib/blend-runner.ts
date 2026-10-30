/**
 * Blend runner: turns the pure signal plan (strategies/blend-core.ts) into paper orders.
 *
 * Runs once per trading day shortly after the open, using the previous session's completed
 * daily bars (so decisions match the backtest: signal at the close, trade at the next open).
 *
 * Safety properties (all covered by lib/blend-runner.test.mjs):
 *  - PAPER ONLY: refuses to run against a live-money Alpaca connection.
 *  - Idempotent orders: deterministic client_order_ids, and a unique ledger index per sleeve+symbol,
 *    so a retried run can never double-buy.
 *  - Ledger first: the position row is written BEFORE the order is sent, so a crash never loses track.
 *  - Sells are sized from the ledger (this strategy's own shares), never from the account's net position.
 *  - Stale or thin data aborts the run instead of trading on it.
 *  - Halal re-check every run: a holding that loses halal status is sold.
 *
 * No imports from '@/...' so it can be unit-tested with fakes.
 */
import {
  planBlend, sizeQty, isMonthEndDecision, BLEND_UNIVERSE, MIN_BARS, SLEEVE_ORDER, BLEND_LIMITS,
  type Bar, type Sleeve, type PlannedOrder,
} from './strategies/blend-core'

// ── ports ────────────────────────────────────────────────────────────────────

export interface BrokerBar { date: Date; open: number; high: number; low: number; close: number }

export interface BlendBroker {
  getClock():    Promise<{ isOpen: boolean } | null>
  getCalendar(start: string, end: string): Promise<Array<{ date: string }>>
  getBars(symbol: string, months: number, timeframe: string,
          opts: { feed?: 'iex' | 'sip'; adjustment?: 'split' }): Promise<BrokerBar[]>
  getAccount():  Promise<{ cash: number; buyingPower: number }>
  placeOrder(o: { symbol: string; qty: number; side: 'buy' | 'sell'; strategy?: string; clientOrderId?: string }):
    Promise<{ ok: boolean; message?: string }>
  getOrderByClientId(id: string): Promise<{ status: string; filledQty: number; filledAvgPrice: number | null } | null>
}

export type LedgerStatus = 'pending_entry' | 'open' | 'pending_exit' | 'closed' | 'cancelled'

export interface LedgerRow {
  id: string
  sleeve: Sleeve
  symbol: string
  status: LedgerStatus
  target_qty: number
  qty: number
  ref_price: number | null
  entry_price: number | null
  entry_date: string
  entry_client_id: string | null
  exit_client_id: string | null
}

export type LedgerPatch = Partial<Omit<LedgerRow, 'id'>> & {
  exit_price?: number | null; exit_date?: string | null; exit_reason?: string | null
  return_pct?: number | null; note?: string | null
}

export interface NewEntry {
  sleeve: Sleeve; symbol: string; target_qty: number; ref_price: number
  entry_date: string; entry_reason: string; entry_client_id: string
}

export interface BlendStore {
  listLive(): Promise<LedgerRow[]>                                   // pending_entry | open | pending_exit
  insertEntry(e: NewEntry): Promise<{ ok: true; id: string } | { ok: false; message: string }>
  update(id: string, patch: LedgerPatch): Promise<void>
  setLastRebalanceMonth(month: string): Promise<void>
}

// ── result ───────────────────────────────────────────────────────────────────

export interface OrderOut {
  sleeve: Sleeve; side: 'buy' | 'sell'; symbol: string; qty: number
  refPrice: number; reason: string; status: 'placed' | 'planned' | 'skipped' | 'failed'; detail?: string
}

export interface RunResult {
  status:   'done' | 'skipped' | 'failed'
  message:  string
  dryRun:   boolean
  runDate:  string
  dataBar:  string | null
  regime:   boolean | null
  monthEnd: boolean
  orders:   OrderOut[]
  errors:   string[]
  feed:     { sip: number; iex: number }
  evaluated: number
  reconciled: number
}

export interface RunOptions {
  broker:   BlendBroker
  store:    BlendStore
  isHalal:  (symbol: string) => boolean
  now?:     Date
  budget:   number
  /** false = manage exits only (user paused the strategy) */
  allowEntries: boolean
  dryRun:   boolean
  /** The brokerage connection's paper flag. Anything but true is refused. */
  paper:    boolean
  /** Skip the market-open check (used by previews, which may run any time). */
  ignoreClock?: boolean
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Calendar date and minutes-since-midnight in New York (DST-safe). */
export function etNow(now: Date): { date: string; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

export const clientOrderId = (runDate: string, sleeve: Sleeve, symbol: string, side: 'buy' | 'sell') =>
  `tickrtalk_BLEND_${runDate}_${sleeve}_${symbol}_${side === 'buy' ? 'B' : 'S'}`

const TERMINAL = new Set(['filled', 'canceled', 'expired', 'rejected', 'done_for_day'])

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

const toBar = (b: BrokerBar): Bar => ({ date: b.date.toISOString().slice(0, 10), o: b.open, h: b.high, l: b.low, c: b.close })

function emptyResult(o: RunOptions, runDate: string, status: RunResult['status'], message: string): RunResult {
  return { status, message, dryRun: o.dryRun, runDate, dataBar: null, regime: null, monthEnd: false, orders: [], errors: [],
           feed: { sip: 0, iex: 0 }, evaluated: 0, reconciled: 0 }
}

// ── fill reconciliation ──────────────────────────────────────────────────────

/** Resolve yesterday's orders into their final ledger state. Returns how many rows changed. */
export async function reconcile(broker: BlendBroker, store: BlendStore, rows: LedgerRow[], today: string): Promise<number> {
  let changed = 0
  for (const row of rows) {
    try {
      if (row.status === 'pending_entry' && row.entry_client_id) {
        const o = await broker.getOrderByClientId(row.entry_client_id)
        if (!o) {
          const ageDays = (Date.parse(today) - Date.parse(row.entry_date)) / 86_400_000
          if (ageDays > 3) { await store.update(row.id, { status: 'cancelled', note: 'Order not found at broker' }); changed++ }
        } else if (TERMINAL.has(o.status) || o.status === 'filled') {
          if (o.filledQty > 0) {
            await store.update(row.id, { status: 'open', qty: Math.round(o.filledQty), entry_price: o.filledAvgPrice,
              note: o.filledQty < row.target_qty ? `Partial fill: ${o.filledQty} of ${row.target_qty}` : null })
          } else await store.update(row.id, { status: 'cancelled', note: `Entry order ${o.status}; no shares bought` })
          changed++
        }
      } else if (row.status === 'pending_exit' && row.exit_client_id) {
        const o = await broker.getOrderByClientId(row.exit_client_id)
        if (!o) {
          await store.update(row.id, { status: 'open', note: 'Exit order not found at broker; will re-evaluate' }); changed++
        } else if (TERMINAL.has(o.status)) {
          if (o.filledQty >= row.qty && o.filledAvgPrice !== null) {
            const ret = row.entry_price ? (o.filledAvgPrice / row.entry_price - 1) * 100 : null
            await store.update(row.id, { status: 'closed', exit_price: o.filledAvgPrice, exit_date: today,
              return_pct: ret === null ? null : +ret.toFixed(3) })
          } else if (o.filledQty > 0) {
            await store.update(row.id, { status: 'open', qty: row.qty - Math.round(o.filledQty), note: `Partial exit: sold ${o.filledQty}` })
          } else await store.update(row.id, { status: 'open', note: `Exit order ${o.status}; still held` })
          changed++
        }
      }
    } catch { /* leave the row as is; it will be retried next run */ }
  }
  return changed
}

// ── the run ──────────────────────────────────────────────────────────────────

export async function runBlend(o: RunOptions): Promise<RunResult> {
  const now = o.now ?? new Date()
  const { date: today } = etNow(now)
  const fail = (m: string) => emptyResult(o, today, 'failed', m)
  const skip = (m: string) => emptyResult(o, today, 'skipped', m)

  if (o.paper !== true) return skip('Blend trades paper accounts only. Connect an Alpaca paper account.')
  if (!(o.budget >= BLEND_LIMITS.minBudget && o.budget <= BLEND_LIMITS.maxBudget)) return skip('Budget is not set.')

  if (!o.dryRun && !o.ignoreClock) {
    const clock = await o.broker.getClock()
    if (!clock) return fail('Could not reach the broker to check market hours.')
    if (!clock.isOpen) return skip('Market is closed today.')
  }

  // 1. Resolve yesterday's orders, then load the ledger.
  let live = await o.store.listLive()
  let reconciled = 0
  if (!o.dryRun) {
    reconciled = await reconcile(o.broker, o.store, live, today)
    if (reconciled) live = await o.store.listLive()
  }

  // 2. Which session should the last bar be?
  let expectedBar: string | null = null
  try {
    const from = new Date(Date.parse(today) - 12 * 86_400_000).toISOString().slice(0, 10)
    const to   = new Date(Date.parse(today) -      86_400_000).toISOString().slice(0, 10)
    const cal  = (await o.broker.getCalendar(from, to)).map(c => c.date).filter(d => d < today).sort()
    expectedBar = cal.at(-1) ?? null
  } catch { /* checked below */ }

  // 3. Fetch bars: halal-verified universe + SPY (regime only, never traded).
  const universe = BLEND_UNIVERSE.filter(o.isHalal)
  const feed = { sip: 0, iex: 0 }
  const fetchOne = async (sym: string): Promise<[string, Bar[]]> => {
    let raw = await o.broker.getBars(sym, 20, '1Day', { feed: 'sip', adjustment: 'split' }).catch(() => [] as BrokerBar[])
    let used: 'sip' | 'iex' = 'sip'
    if (raw.length < MIN_BARS) { raw = await o.broker.getBars(sym, 20, '1Day', { feed: 'iex', adjustment: 'split' }).catch(() => []); used = 'iex' }
    const bars = raw.map(toBar).filter(b => b.date < today)       // completed sessions only
    if (bars.length >= MIN_BARS) feed[used]++
    return [sym, bars]
  }
  const fetched = await pool(['SPY', ...universe], 8, fetchOne)
  const spy = fetched[0][1]
  const bars: Record<string, Bar[]> = Object.fromEntries(fetched.slice(1).filter(([, b]) => b.length >= MIN_BARS))

  const dataBar = spy.at(-1)?.date ?? null
  const base = { ...emptyResult(o, today, 'done', ''), dataBar, feed, reconciled }
  if (!dataBar || spy.length < MIN_BARS) return { ...base, status: 'failed', message: 'Market data unavailable (SPY history missing).' }
  if (expectedBar && dataBar !== expectedBar)
    return { ...base, status: 'failed', message: `Market data is stale: latest bar is ${dataBar}, expected ${expectedBar}. No orders sent.` }
  const coverage = Object.keys(bars).length / Math.max(universe.length, 1)
  if (coverage < 0.8)
    return { ...base, status: 'failed', message: `Only ${Object.keys(bars).length} of ${universe.length} symbols had usable data. No orders sent.` }

  // 4. Plan.
  const held: Record<Sleeve, string[]> = { mom: [], down3: [], ibs: [], crsi: [] }
  const pending: Record<Sleeve, string[]> = { mom: [], down3: [], ibs: [], crsi: [] }
  for (const r of live) (r.status === 'open' ? held : pending)[r.sleeve].push(r.symbol)
  const forceExit = new Set(live.filter(r => r.status === 'open' && !o.isHalal(r.symbol)).map(r => r.symbol))
  const monthEnd = isMonthEndDecision(dataBar, today)
  const plan = planBlend({ universe: bars, spy, held, pending, monthEnd, forceExit })
  const result: RunResult = { ...base, regime: plan.regime, monthEnd, evaluated: plan.evaluated }

  // 5. Size and (unless dry run) place: exits first, then entries.
  let account: { cash: number } | null = null
  if (!o.dryRun) account = await o.broker.getAccount().catch(() => null)
  let cashLeft = account ? account.cash : Infinity
  if (!o.dryRun && !account) result.errors.push('Could not read account cash; entries skipped this run.')

  const sells = plan.orders.filter(x => x.side === 'sell')
  const buys  = plan.orders.filter(x => x.side === 'buy' && o.allowEntries)
  if (!o.allowEntries && plan.orders.some(x => x.side === 'buy')) result.message = 'Strategy is paused: exits only.'

  const push = (p: PlannedOrder, qty: number, status: OrderOut['status'], detail?: string) =>
    result.orders.push({ sleeve: p.sleeve, side: p.side, symbol: p.symbol, qty, refPrice: p.refPrice, reason: p.reason, status, detail })

  for (const p of sells) {
    const row = live.find(r => r.status === 'open' && r.sleeve === p.sleeve && r.symbol === p.symbol)
    if (!row || row.qty < 1) { push(p, 0, 'skipped', 'No filled shares in ledger'); continue }
    if (o.dryRun) { push(p, row.qty, 'planned'); continue }
    const id = clientOrderId(today, p.sleeve, p.symbol, 'sell')
    const r = await o.broker.placeOrder({ symbol: p.symbol, qty: row.qty, side: 'sell', strategy: 'BLEND', clientOrderId: id })
    if (r.ok) {
      await o.store.update(row.id, { status: 'pending_exit', exit_client_id: id, exit_date: today, exit_reason: p.reason })
      push(p, row.qty, 'placed')
    } else { push(p, row.qty, 'failed', r.message); result.errors.push(`${p.symbol} sell: ${r.message}`) }
  }

  for (const p of buys) {
    const qty = sizeQty(o.budget, p.sleeve, p.refPrice)
    if (qty < 1) { push(p, 0, 'skipped', 'Position size is less than one share'); continue }
    const cost = qty * p.refPrice
    if (!o.dryRun && cost > cashLeft) { push(p, qty, 'skipped', 'Not enough cash'); continue }
    if (o.dryRun) { push(p, qty, 'planned'); continue }
    const id = clientOrderId(today, p.sleeve, p.symbol, 'buy')
    // ledger first, so a crash after the order is sent can never lose track of the shares
    const ins = await o.store.insertEntry({ sleeve: p.sleeve, symbol: p.symbol, target_qty: qty, ref_price: p.refPrice,
                                            entry_date: today, entry_reason: p.reason, entry_client_id: id })
    if (!ins.ok) { push(p, qty, 'skipped', `Ledger: ${ins.message}`); continue }
    const r = await o.broker.placeOrder({ symbol: p.symbol, qty, side: 'buy', strategy: 'BLEND', clientOrderId: id })
    if (r.ok) { cashLeft -= cost; push(p, qty, 'placed') }
    else {
      await o.store.update(ins.id, { status: 'cancelled', note: `Order rejected: ${r.message}` })
      push(p, qty, 'failed', r.message); result.errors.push(`${p.symbol} buy: ${r.message}`)
    }
  }

  if (!o.dryRun && monthEnd) await o.store.setLastRebalanceMonth(dataBar.slice(0, 7)).catch(() => {})

  const n = (s: OrderOut['status']) => result.orders.filter(x => x.status === s).length
  result.message = [
    result.message,
    o.dryRun ? `Preview: ${n('planned')} orders would be placed` : `${n('placed')} orders placed`,
    n('skipped') ? `${n('skipped')} skipped` : '', n('failed') ? `${n('failed')} failed` : '',
    plan.regime === false ? 'SPY below 200-day average: no new momentum/dip entries' : '',
  ].filter(Boolean).join('. ')
  if (result.errors.length && n('placed') === 0 && n('planned') === 0 && !o.dryRun) result.status = 'failed'
  return result
}

export { SLEEVE_ORDER }
