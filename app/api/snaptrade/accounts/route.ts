/**
 * GET /api/snaptrade/accounts
 *
 * Returns all SnapTrade accounts + brokerage authorizations for the current user.
 */
import { requireUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccounts, listAuthorizations } from '@/lib/snaptrade'
import { NextResponse } from 'next/server'

export async function GET() {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('snaptrade_user_secret')
    .eq('id', userId)
    .single()

  if (!user?.snaptrade_user_secret) {
    return NextResponse.json({ registered: false, accounts: [], authorizations: [] })
  }

  let userSecret: string
  try {
    userSecret = decrypt(user.snaptrade_user_secret)
  } catch {
    return NextResponse.json({ error: 'Failed to decrypt credentials' }, { status: 500 })
  }

  try {
    const [accounts, authorizations] = await Promise.all([
      listAccounts(userId, userSecret),
      listAuthorizations(userId, userSecret),
    ])

    return NextResponse.json({
      registered: true,
      accounts,
      authorizations,
    })
  } catch (err) {
    console.error('SnapTrade accounts error:', err)
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to fetch accounts' },
      { status: 500 },
    )
  }
}
