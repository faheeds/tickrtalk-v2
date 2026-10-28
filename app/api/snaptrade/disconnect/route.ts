/**
 * POST /api/snaptrade/disconnect
 *
 * Body: { authorizationId: string }
 * Deletes a single broker authorization from SnapTrade.
 */
import { requireUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { deleteAuthorization } from '@/lib/snaptrade'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { authorizationId } = await req.json().catch(() => ({}))
  if (!authorizationId) {
    return NextResponse.json({ error: 'authorizationId is required' }, { status: 400 })
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('snaptrade_user_secret')
    .eq('id', userId)
    .single()

  if (!user?.snaptrade_user_secret) {
    return NextResponse.json({ error: 'Not registered with SnapTrade' }, { status: 428 })
  }

  let userSecret: string
  try {
    userSecret = decrypt(user.snaptrade_user_secret)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt credentials' }, { status: 500 })
  }

  try {
    await deleteAuthorization(userId, userSecret, authorizationId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('SnapTrade disconnect error:', err)
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to disconnect broker' },
      { status: 500 },
    )
  }
}
