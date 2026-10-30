/**
 * POST /api/blend/preview — compute what the strategy WOULD do now, without placing orders
 * or touching the ledger. Uses the last completed daily bar, exactly like the daily run.
 */
import { requireUser, isProUser, getActiveBrokerConnection } from '@/lib/auth'
import { supabaseAdmin }      from '@/lib/supabase'
import { createAlpacaClient } from '@/lib/alpaca'
import { decrypt }            from '@/lib/crypto'
import { getVerdict }         from '@/lib/halal'
import { runBlend }           from '@/lib/blend-runner'
import { supabaseBlendStore } from '@/lib/blend-store'
import { BLEND_LIMITS }       from '@/lib/strategies/blend-core'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

const err = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status })

export async function POST(req: NextRequest) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return err('Unauthorized', 401)
  if (!(await isProUser(userId))) return err('Blend is a Pro feature.', 403, { upgrade: true })

  const conn = await getActiveBrokerConnection(userId)
  if (!conn) return err('Connect an Alpaca paper account first (Settings).')
  if (conn.paper_mode !== true) return err('Blend trades paper accounts only. Switch your Alpaca connection to paper mode.')

  const body = await req.json().catch(() => ({})) as { budget?: unknown }
  const { data: cfg } = await supabaseAdmin.from('blend_config').select('budget, last_preview_at').eq('user_id', userId).maybeSingle()
  const budget = body.budget !== undefined && body.budget !== null ? Number(body.budget) : Number(cfg?.budget) || 0
  if (!Number.isFinite(budget) || budget < BLEND_LIMITS.minBudget || budget > BLEND_LIMITS.maxBudget)
    return err(`Enter a budget of at least $${BLEND_LIMITS.minBudget.toLocaleString('en-US')} to preview.`)

  // The preview reads ~95 symbols with the user's own Alpaca keys: keep it from starving their other strategies.
  if (cfg?.last_preview_at && Date.now() - Date.parse(cfg.last_preview_at) < 60_000)
    return err('Please wait a minute between previews.', 429)
  await supabaseAdmin.from('blend_config').upsert({ user_id: userId, last_preview_at: new Date().toISOString() }, { onConflict: 'user_id' })

  const alpaca = createAlpacaClient({
    apiKey: decrypt(conn.api_key_encrypted as string), apiSecret: decrypt(conn.api_secret_encrypted as string), paper: true,
  })
  try {
    const res = await runBlend({
      broker: alpaca, store: supabaseBlendStore(userId), isHalal: s => getVerdict(s) === 'HALAL',
      budget, allowEntries: true, dryRun: true, paper: true, ignoreClock: true,
    })
    return NextResponse.json({ ok: true, result: res })
  } catch (e) {
    console.error('[blend preview]', (e as Error).message)
    return err('Preview failed. Try again in a minute.', 502)
  }
}
