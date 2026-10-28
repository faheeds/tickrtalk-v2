/**
 * GET  /api/algo/allocations  — fetch the current user's budget allocations
 * PUT  /api/algo/allocations  — save updated allocations
 *
 * Requires: algo_allocations table in Supabase (see SQL migration in docs).
 */
import { requireUser }   from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

const DEFAULTS = { dayBudget: 0, swingBudget: 0, longtermBudget: 0 }

export async function GET() {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('algo_allocations')
    .select('day_budget, swing_budget, longterm_budget')
    .eq('user_id', userId)
    .single()

  if (!data) return NextResponse.json(DEFAULTS)

  return NextResponse.json({
    dayBudget:      Number(data.day_budget)      || 0,
    swingBudget:    Number(data.swing_budget)    || 0,
    longtermBudget: Number(data.longterm_budget) || 0,
  })
}

export async function PUT(req: NextRequest) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const dayBudget      = Math.max(0, Number(body.dayBudget)      || 0)
  const swingBudget    = Math.max(0, Number(body.swingBudget)    || 0)
  const longtermBudget = Math.max(0, Number(body.longtermBudget) || 0)

  const { error } = await supabaseAdmin
    .from('algo_allocations')
    .upsert({
      user_id:         userId,
      day_budget:      dayBudget,
      swing_budget:    swingBudget,
      longterm_budget: longtermBudget,
      updated_at:      new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, dayBudget, swingBudget, longtermBudget })
}
