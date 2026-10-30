// Vercel Cron — runs the Blend strategy once per trading day, shortly after the open.
// Two schedules (13:35 and 14:35 UTC) cover daylight-saving time; the ET window below
// picks whichever one lands at ~9:35 ET, and a per-user, per-day row makes it idempotent.
// Protected by CRON_SECRET (same as the other cron routes).
import { supabaseAdmin }      from '@/lib/supabase'
import { createAlpacaClient } from '@/lib/alpaca'
import { decrypt }            from '@/lib/crypto'
import { getVerdict }         from '@/lib/halal'
import { runBlend, etNow }  from '@/lib/blend-runner'
import { supabaseBlendStore } from '@/lib/blend-store'
import { NextResponse }       from 'next/server'

export const maxDuration = 60

const WINDOW_START = 9 * 60 + 32     // 9:32 ET
const WINDOW_END   = 11 * 60 + 30    // 11:30 ET
const TIME_BUDGET_MS = 48_000        // stop starting new users after this; the second cron entry picks up the rest

export async function GET(req: Request) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const started = Date.now()
  const { date: runDate, minutes } = etNow(new Date())
  if (minutes < WINDOW_START || minutes > WINDOW_END)
    return NextResponse.json({ ok: true, ran: 0, reason: 'Outside the 9:32–11:30 ET window' })

  // Users with the strategy on, or with positions still open (paused users keep getting exits).
  const [{ data: enabled }, { data: openRows }] = await Promise.all([
    supabaseAdmin.from('blend_config').select('user_id, enabled, budget').eq('enabled', true),
    supabaseAdmin.from('blend_positions').select('user_id').in('status', ['pending_entry', 'open', 'pending_exit']),
  ])
  const ids = [...new Set([...(enabled ?? []).map(r => r.user_id), ...(openRows ?? []).map(r => r.user_id)])] as string[]
  if (!ids.length) return NextResponse.json({ ok: true, ran: 0 })

  const summary: Array<{ user: string; status: string; message: string }> = []

  for (const userId of ids) {
    if (Date.now() - started > TIME_BUDGET_MS) { summary.push({ user: userId, status: 'deferred', message: 'time budget' }); continue }

    // Claim today's run (unique per user+date). Retry only a failed or abandoned run.
    const claim = await supabaseAdmin.from('blend_runs').insert({ user_id: userId, run_date: runDate, status: 'running' }).select('id').single()
    let runId = claim.data?.id as string | undefined
    if (!runId) {
      const { data: prev } = await supabaseAdmin.from('blend_runs').select('id, status, created_at')
        .eq('user_id', userId).eq('run_date', runDate).maybeSingle()
      const stale = prev?.status === 'running' && Date.now() - Date.parse(prev.created_at) > 10 * 60_000
      if (!prev || !(prev.status === 'failed' || stale)) continue
      await supabaseAdmin.from('blend_runs').update({ status: 'running', created_at: new Date().toISOString() }).eq('id', prev.id)
      runId = prev.id
    }

    const finish = (patch: Record<string, unknown>) =>
      supabaseAdmin.from('blend_runs').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', runId!)

    try {
      const { data: user } = await supabaseAdmin.from('users')
        .select('subscription_tier, subscription_status, trial_ends_at').eq('id', userId).single()
      const active = !!user && (
        (user.subscription_tier === 'pro' && user.subscription_status === 'active') ||
        (user.subscription_status === 'trial' && new Date(user.trial_ends_at) > new Date()))
      if (!active) { await finish({ status: 'skipped', message: 'Subscription inactive' }); summary.push({ user: userId, status: 'skipped', message: 'inactive' }); continue }

      const { data: conn } = await supabaseAdmin.from('brokerage_connections').select('*')
        .eq('user_id', userId).eq('broker', 'alpaca').eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (!conn) { await finish({ status: 'skipped', message: 'No active Alpaca connection' }); continue }

      const { data: cfg } = await supabaseAdmin.from('blend_config').select('enabled, budget').eq('user_id', userId).maybeSingle()

      const alpaca = createAlpacaClient({
        apiKey: decrypt(conn.api_key_encrypted as string),
        apiSecret: decrypt(conn.api_secret_encrypted as string),
        paper: conn.paper_mode as boolean,
      })
      const res = await runBlend({
        broker: alpaca,
        store: supabaseBlendStore(userId),
        isHalal: s => getVerdict(s) === 'HALAL',
        budget: Number(cfg?.budget) || 0,
        allowEntries: !!cfg?.enabled,
        dryRun: false,
        paper: conn.paper_mode === true,
      })
      await finish({
        status: res.status === 'done' ? 'done' : res.status, message: res.message, regime: res.regime, data_bar: res.dataBar,
        summary: { evaluated: res.evaluated, reconciled: res.reconciled, monthEnd: res.monthEnd, feed: res.feed },
        orders: res.orders, errors: res.errors,
      })
      summary.push({ user: userId, status: res.status, message: res.message })
    } catch (e) {
      console.error('[CRON blend] user=' + userId, (e as Error).message)
      await finish({ status: 'failed', message: 'Unexpected error', errors: [(e as Error).message] })
      summary.push({ user: userId, status: 'failed', message: 'unexpected error' })
    }
  }

  return NextResponse.json({ ok: true, ran: summary.length, summary, timestamp: new Date().toISOString() })
}
