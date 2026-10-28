import { requireUser }   from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { NextResponse }  from 'next/server'

export async function POST(req: Request) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { symbol } = await req.json()
  const sym = symbol?.toUpperCase()?.trim()
  const { data: wl } = await supabaseAdmin.from('watchlists').select('symbols').eq('user_id', userId).single()
  const symbols = (wl?.symbols ?? []).filter((s: string) => s !== sym)
  await supabaseAdmin.from('watchlists').update({ symbols }).eq('user_id', userId)
  return NextResponse.json({ ok: true, symbols })
}
