import { requireUser }   from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { NextResponse }  from 'next/server'

export async function POST(req: Request) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { symbol } = await req.json()
  const sym = symbol?.toUpperCase()?.trim()
  if (!sym) return NextResponse.json({ error: 'Symbol required' }, { status: 400 })

  const { data: wl } = await supabaseAdmin.from('watchlists').select('symbols').eq('user_id', userId).single()
  const symbols = wl?.symbols ?? []
  if (!symbols.includes(sym)) {
    await supabaseAdmin.from('watchlists').upsert({ user_id: userId, symbols: [...symbols, sym] }, { onConflict: 'user_id' })
  }
  return NextResponse.json({ ok: true, symbols: [...symbols, sym].filter((v, i, a) => a.indexOf(v) === i) })
}
