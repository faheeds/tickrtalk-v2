// Tests for lib/strategies/blend-core.ts (pure logic; no network).
//   node --experimental-strip-types --no-warnings --test lib/strategies/blend-core.test.mjs
// Parity cases come from research/blend/blend_ref.py via research/blend/gen_parity_fixture.py.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  computeIndicators, planBlend, regimeOn, rsiSeries, sizeQty, slotDollars, isMonthEndDecision,
  BLEND_SLEEVES, BLEND_UNIVERSE, MIN_BARS, SLEEVE_ORDER,
} from '../lib/strategies/blend-core.ts'

const fx = JSON.parse(readFileSync(new URL('./fixtures/blend_parity.json', import.meta.url), 'utf8'))
const toBars = s => fx.bars[s].d.map((d, i) => ({ date: d, o: fx.bars[s].o[i], h: fx.bars[s].h[i], l: fx.bars[s].l[i], c: fx.bars[s].c[i] }))
const SERIES = Object.fromEntries(Object.keys(fx.bars).map(s => [s, toBars(s)]))
const upTo = (bars, d) => bars.filter(b => b.date <= d)
const near = (a, b, msg) => {
  if (b === null || a === null) return assert.equal(a, b, msg)
  assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`)
}
const key = o => `${o.sleeve}|${o.side}|${o.symbol}`

// ── parity with the Python reference ────────────────────────────────────────

test('indicators match the Python reference on every case and symbol', () => {
  let checked = 0
  for (const c of fx.cases) for (const [sym, ref] of Object.entries(c.indicators)) {
    const got = computeIndicators(upTo(SERIES[sym], c.asof))
    assert.ok(got, `${sym}@${c.asof} should have enough history`)
    for (const [pyKey, tsKey] of [['sma5', 'sma5'], ['sma200', 'sma200'], ['rsi2', 'rsi2'], ['cumrsi2', 'cumrsi2'], ['ibs', 'ibs'],
                                  ['prev_high', 'prevHigh'], ['ret3', 'ret3'], ['mom', 'mom'], ['vol60', 'vol60'], ['momvol', 'momvol'], ['close', 'close']]) {
      near(got[tsKey], ref[pyKey], `${sym}@${c.asof} ${tsKey}`); checked++
    }
    assert.equal(got.down3, Boolean(ref.down3), `${sym}@${c.asof} down3`)
  }
  assert.ok(checked > 400, `checked ${checked} values`)
})

test('regime flag matches the reference (including risk-off days)', () => {
  const states = new Set()
  for (const c of fx.cases) { assert.equal(regimeOn(upTo(SERIES.SPY, c.asof)), c.regime, c.asof); states.add(c.regime) }
  assert.deepEqual([...states].sort(), [false, true], 'fixture should include both regimes')
})

test('order plans match the reference, with nothing held and with positions held', () => {
  let buys = 0, sells = 0
  for (const c of fx.cases) {
    const universe = Object.fromEntries(Object.keys(fx.bars).filter(s => s !== 'SPY').map(s => [s, upTo(SERIES[s], c.asof)]))
    const spy = upTo(SERIES.SPY, c.asof)
    const empty = planBlend({ universe, spy, held: { mom: [], down3: [], ibs: [], crsi: [] }, monthEnd: c.month_end })
    assert.deepEqual(empty.orders.map(key).sort(), c.plan_empty.map(([a, b, s]) => `${a}|${b}|${s}`).sort(), `empty plan @${c.asof}`)
    const held = planBlend({ universe, spy, held: fx.held, monthEnd: c.month_end })
    assert.deepEqual(held.orders.map(key).sort(), c.plan_held.map(([a, b, s]) => `${a}|${b}|${s}`).sort(), `held plan @${c.asof}`)
    for (const o of held.orders) o.side === 'buy' ? buys++ : sells++
  }
  assert.ok(buys > 20 && sells > 3, `fixture should exercise buys and sells (buys ${buys}, sells ${sells})`)
})

// ── logic on synthetic data ─────────────────────────────────────────────────

function series(n, f) { return Array.from({ length: n }, (_, t) => { const c = f(t); return { date: `d${String(t).padStart(4, '0')}`, o: c, h: c * 1.005, l: c * 0.995, c } }) }
const rising = (g, k = 0) => series(320, t => 100 * Math.pow(1 + g, t) * (1 + 0.004 * Math.sin(0.7 * t + k)))
const SPY_UP = series(320, t => 100 * Math.pow(1.0005, t))
const SPY_DOWN = series(320, t => 200 * Math.pow(0.999, t))
const NONE = { mom: [], down3: [], ibs: [], crsi: [] }

// 30 symbols, strictly ordered momentum: S29 strongest ... S00 weakest, all in uptrends
const universe30 = Object.fromEntries(Array.from({ length: 30 }, (_, k) => [`S${String(k).padStart(2, '0')}`, rising(0.0005 + 0.0001 * k, k)]))

test('momentum sleeve: buys the top 10 only at month end, never mid-month', () => {
  const mid = planBlend({ universe: universe30, spy: SPY_UP, held: NONE, monthEnd: false })
  assert.equal(mid.orders.filter(o => o.sleeve === 'mom').length, 0)
  const me = planBlend({ universe: universe30, spy: SPY_UP, held: NONE, monthEnd: true })
  const buys = me.orders.filter(o => o.sleeve === 'mom' && o.side === 'buy').map(o => o.symbol).sort()
  assert.deepEqual(buys, Array.from({ length: 10 }, (_, i) => `S${20 + i}`))
})

test('momentum sleeve: sells a holding only when rank falls past 20, and only at month end', () => {
  const held = { ...NONE, mom: ['S00', 'S15'] }                // S00 is rank 30; S15 is rank 15 (kept)
  const mid = planBlend({ universe: universe30, spy: SPY_UP, held, monthEnd: false })
  assert.equal(mid.orders.filter(o => o.side === 'sell' && o.sleeve === 'mom').length, 0)
  const me = planBlend({ universe: universe30, spy: SPY_UP, held, monthEnd: true })
  assert.deepEqual(me.orders.filter(o => o.side === 'sell' && o.sleeve === 'mom').map(o => o.symbol), ['S00'])
})

test('risk-off gate blocks new mom/down3/ibs entries but not exits or crsi', () => {
  const me = planBlend({ universe: universe30, spy: SPY_DOWN, held: { ...NONE, mom: ['S00'] }, monthEnd: true })
  assert.equal(me.regime, false)
  assert.equal(me.orders.filter(o => o.side === 'buy' && o.sleeve !== 'crsi').length, 0)
  assert.equal(me.orders.filter(o => o.side === 'sell').length, 1, 'exits still happen when the gate is off')
})

test('missing SPY history is treated as risk-off (fail closed)', () => {
  const p = planBlend({ universe: universe30, spy: SPY_UP.slice(0, 100), held: NONE, monthEnd: true })
  assert.equal(p.regime, null)
  assert.equal(p.orders.filter(o => o.side === 'buy' && o.sleeve !== 'crsi').length, 0)
})

test('slot accounting: held + pending fill slots; exits free them; no duplicates within a sleeve', () => {
  // a 3-down-day dip on ten uptrending symbols; 10 slots, 8 already taken (6 held, 2 pending)
  const dip = Object.fromEntries(Array.from({ length: 10 }, (_, k) => {
    const b = rising(0.001, k)
    const n = b.length
    for (let i = 1; i <= 3; i++) { const c = b[n - 4].c * (1 - 0.01 * i); b[n - 4 + i] = { ...b[n - 4 + i], o: c, h: c * 1.005, l: c * 0.995, c } }
    return [`D${k}`, b]
  }))
  const heldIds = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'], pendingIds = ['D6', 'D7']
  const p = planBlend({ universe: dip, spy: SPY_UP, held: { ...NONE, down3: heldIds }, pending: { down3: pendingIds }, monthEnd: false })
  const d3 = p.orders.filter(o => o.sleeve === 'down3')
  assert.deepEqual(d3.filter(o => o.side === 'buy').map(o => o.symbol).sort(), ['D8', 'D9'], 'only 2 free slots, and held/pending are not re-bought')
  assert.equal(d3.filter(o => o.side === 'sell').length, 0, 'no bounce yet, so nothing exits')
})

test('exit frees a slot for a new entry in the same run (sell first, then buy)', () => {
  const dip = rising(0.001, 3), n = dip.length
  for (let i = 1; i <= 3; i++) { const c = dip[n - 4].c * (1 - 0.01 * i); dip[n - 4 + i] = { ...dip[n - 4 + i], o: c, h: c * 1.005, l: c * 0.995, c } }
  const bounced = rising(0.001, 5); bounced[n - 1] = { ...bounced[n - 1], c: bounced[n - 1].c * 1.2, h: bounced[n - 1].c * 1.25 }   // close well above 5-day average
  const ten = Array.from({ length: 9 }, (_, i) => `H${i}`)
  const universe = { NEW: dip, BNC: bounced, ...Object.fromEntries(ten.map(s => [s, rising(0.001, 9)])) }
  const p = planBlend({ universe, spy: SPY_UP, held: { ...NONE, down3: ['BNC', ...ten] }, monthEnd: false })   // 10/10 slots full
  const o = p.orders.filter(x => x.sleeve === 'down3')
  assert.ok(o.some(x => x.side === 'sell' && x.symbol === 'BNC'))
  assert.ok(o.some(x => x.side === 'buy' && x.symbol === 'NEW'), 'freed slot is refilled')
})

test('forceExit sells a holding that is no longer halal, whatever the signals say', () => {
  const p = planBlend({ universe: universe30, spy: SPY_UP, held: { ...NONE, mom: ['S29'] }, monthEnd: false, forceExit: new Set(['S29']) })
  const s = p.orders.find(o => o.side === 'sell')
  assert.equal(s.symbol, 'S29'); assert.match(s.reason, /halal/i)
})

test('symbols with too little history are skipped, not guessed', () => {
  const p = planBlend({ universe: { ...universe30, NEWIPO: rising(0.001).slice(0, MIN_BARS - 1) }, spy: SPY_UP, held: NONE, monthEnd: true })
  assert.deepEqual(p.noData, ['NEWIPO']); assert.equal(p.evaluated, 30)
})

// ── helpers ─────────────────────────────────────────────────────────────────

test('rsiSeries edge cases', () => {
  assert.equal(rsiSeries([1, 2, 3, 4, 5], 2).at(-1), 100)               // only gains
  assert.equal(rsiSeries([5, 4, 3, 2, 1], 2).at(-1), 0)                 // only losses
  assert.equal(rsiSeries([3, 3, 3, 3], 2).at(-1), null)                 // flat: undefined, never a signal
  assert.equal(rsiSeries([3], 2)[0], null)
})

test('sizing: budget split in four sleeves, then evenly across slots; whole shares only', () => {
  assert.equal(slotDollars(100_000, 'mom'), 2500)
  assert.equal(slotDollars(100_000, 'crsi'), 1250)
  assert.equal(sizeQty(100_000, 'mom', 187.5), 13)
  assert.equal(sizeQty(100_000, 'crsi', 1300), 0)       // too small for one share: caller must skip, not round up
  assert.equal(sizeQty(100_000, 'ibs', 0), 0)
  assert.equal(SLEEVE_ORDER.reduce((s, k) => s + BLEND_SLEEVES[k].slots, 0), 50)
})

test('month-end decision: last bar in an earlier month than today', () => {
  assert.equal(isMonthEndDecision('2026-09-30', '2026-10-01'), true)
  assert.equal(isMonthEndDecision('2026-10-01', '2026-10-02'), false)
  assert.equal(isMonthEndDecision('2026-12-31', '2027-01-04'), true)
})

test('universe is clean: unique, uppercase, 1-5 letters', () => {
  assert.equal(new Set(BLEND_UNIVERSE).size, BLEND_UNIVERSE.length)
  for (const s of BLEND_UNIVERSE) assert.match(s, /^[A-Z]{1,5}$/)
  assert.ok(BLEND_UNIVERSE.length >= 90)
})

test('momentum keep-rank boundary: rank 20 is kept, rank 21 is sold', () => {
  const me = planBlend({ universe: universe30, spy: SPY_UP, held: { ...NONE, mom: ['S10', 'S09'] }, monthEnd: true })   // S10 = rank 20, S09 = rank 21
  assert.deepEqual(me.orders.filter(o => o.side === 'sell' && o.sleeve === 'mom').map(o => o.symbol), ['S09'])
})
