/**
 * GET /api/blend   current settings, positions by sleeve, realised stats, recent runs
 * PUT /api/blend   { enabled?: boolean, budget?: number }
 *
 * Paper trading only: the strategy cannot be switched on unless the active Alpaca
 * connection is a paper account. Requires supabase/migrations/20261029_blend.sql.
 */
import { requireUser, isProUser, getActiveBrokerConnection } from '@/lib/auth'
import { supabaseAdmin }      from '@/lib/supabase'
import { createAlpacaClient } from '@/lib/alpaca'
import { decrypt }            from '@/lib/crypto'
import { BLEND_LIMITS, BLEND_SLEEVES, SLEEVE_ORDER, BLEND_UNIVERSE, type Sleeve } from '@/lib/strategies/blend-core'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

const err = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status })
const n = (x: unknown) => (x === null || x === undefined ? null : Number(x))

export async function GET() {
  const userId = await requireUser().catch(() => null)
  if (!userId) return err('Unauthorized', 401)

  const [cfgQ, liveQ, closedQ, runsQ, conn, pro] = await Promise.all([
    supabaseAdmin.from('blend_config').select('enabled, budget, last_rebalance_month').eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('blend_positions')
      .select('id, sleeve, symbol, status, qty, target_qty, ref_price, entry_price, entry_date, entry_reason, exit_reason, note')
      .eq('user_id', userId).in('status', ['pending_entry', 'open', 'pending_exit']).order('entry_date', { ascending: false }),
    supabaseAdmin.from('blend_positions')
      .select('id, sleeve, symbol, qty, entry_price, entry_date, exit_price, exit_date, exit_reason, return_pct')
      .eq('user_id', userId).eq('status', 'closed').order('exit_date', { ascending: false }).limit(500),
    supabaseAdmin.from('blend_runs')
      .select('id, run_date, status, message, regime, data_bar, summary, orders, errors, created_at')
      .eq('user_id', userId).order('run_date', { ascending: false }).limit(14),
    getActiveBrokerConnection(userId),
    isProUser(userId),
  ])
  if (cfgQ.error && !/does not exist/i.test(cfgQ.error.message)) return err('Could not load Blend settings.', 500)
  const migrated = !(cfgQ.error && /does not exist/i.test(cfgQ.error.message))

  // Live prices for unrealised P&L and the paper account balance (best effort).
  let prices: Record<string, number> = {}
  let account: { equity: number; cash: number } | null = null
  if (conn) {
    try {
      const alpaca = createAlpacaClient({
        apiKey: decrypt(conn.api_key_encrypted as string), apiSecret: decrypt(conn.api_secret_encrypted as string),
        paper: conn.paper_mode as boolean,
      })
      const [pos, acct] = await Promise.all([alpaca.getPositions().catch(() => []), alpaca.getAccount().catch(() => null)])
      prices = Object.fromEntries(pos.map(p => [p.symbol, p.currentPrice]))
      if (acct) account = { equity: acct.equity, cash: acct.cash }
    } catch { /* leave empty */ }
  }

  const live = (liveQ.data ?? []).map(r => {
    const entry = n(r.entry_price), px = prices[r.symbol] ?? null
    return { ...r, ref_price: n(r.ref_price), entry_price: entry,
             current_price: px, unrealized_pct: entry && px ? +(((px / entry) - 1) * 100).toFixed(2) : null }
  })

  const closed = closedQ.data ?? []
  const stats = Object.fromEntries(SLEEVE_ORDER.map(s => {
    const c = closed.filter(r => r.sleeve === s && r.return_pct !== null)
    const rets = c.map(r => Number(r.return_pct))
    return [s, {
      closed: c.length,
      winRate: c.length ? rets.filter(x => x > 0).length / c.length : null,
      avgReturnPct: c.length ? +(rets.reduce((a, b) => a + b, 0) / c.length).toFixed(2) : null,
      open: live.filter(r => r.sleeve === s && r.status === 'open').length,
    }]
  }))

  return NextResponse.json({
    migrated, pro,
    config: { enabled: !!cfgQ.data?.enabled, budget: Number(cfgQ.data?.budget) || 0, lastRebalanceMonth: cfgQ.data?.last_rebalance_month ?? null },
    broker: { connected: !!conn, paper: conn ? conn.paper_mode === true : null, account },
    limits: BLEND_LIMITS,
    universeSize: BLEND_UNIVERSE.length,
    sleeves: Object.fromEntries(SLEEVE_ORDER.map(s => [s, BLEND_SLEEVES[s as Sleeve]])),
    stats, live,
    closed: closed.slice(0, 40).map(r => ({ ...r, entry_price: n(r.entry_price), exit_price: n(r.exit_price), return_pct: n(r.return_pct) })),
    runs: runsQ.data ?? [],
  })
}

export async function PUT(req: NextRequest) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return err('Unauthorized', 401)
  if (!(await isProUser(userId))) return err('Blend is a Pro feature.', 403, { upgrade: true })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return err('Invalid JSON')

  const { data: current } = await supabaseAdmin.from('blend_config').select('enabled, budget').eq('user_id', userId).maybeSingle()
  const budget = body.budget === undefined ? Number(current?.budget) || 0 : Number(body.budget)
  const enabled = body.enabled === undefined ? !!current?.enabled : body.enabled === true

  if (!Number.isFinite(budget) || budget < 0 || budget > BLEND_LIMITS.maxBudget)
    return err(`Budget must be between $${BLEND_LIMITS.minBudget.toLocaleString('en-US')} and $${BLEND_LIMITS.maxBudget.toLocaleString('en-US')}.`)

  if (enabled) {
    if (budget < BLEND_LIMITS.minBudget) return err(`Budget must be at least $${BLEND_LIMITS.minBudget.toLocaleString('en-US')} so each of the 50 slots can buy shares.`)
    const conn = await getActiveBrokerConnection(userId)
    if (!conn) return err('Connect an Alpaca paper account first (Settings).', 400)
    if (conn.paper_mode !== true) return err('Blend trades paper accounts only. Switch your Alpaca connection to paper mode.', 400)
  }

  const { error } = await supabaseAdmin.from('blend_config')
    .upsert({ user_id: userId, enabled, budget, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) {
    console.error('[blend] config save failed:', error.message)
    return err(/does not exist/i.test(error.message) ? 'Run the Blend database migration first.' : 'Could not save settings.', 500)
  }
  return NextResponse.json({ ok: true, enabled, budget })
}
