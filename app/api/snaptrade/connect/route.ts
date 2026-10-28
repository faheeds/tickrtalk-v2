/**
 * POST /api/snaptrade/connect
 *
 * Generates a SnapTrade OAuth portal URL for the current user.
 * Body: { broker?: string, reconnect?: string }
 * Returns { redirectURI }
 */
import { requireUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { generateLoginLink, SnapTradeError } from '@/lib/snaptrade'
import { NextRequest, NextResponse } from 'next/server'

async function getUserSecret(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('snaptrade_user_secret')
    .eq('id', userId)
    .single()

  if (!data?.snaptrade_user_secret) return null
  try {
    return decrypt(data.snaptrade_user_secret)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userSecret = await getUserSecret(userId)
  if (!userSecret) {
    return NextResponse.json(
      { error: 'Your brokerage connection setup is incomplete. Please contact support to restore access.', code: 'SNAPTRADE_PROFILE_RECOVERY_REQUIRED' },
      { status: 428 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tickrtalk.io'

  try {
    const result = await generateLoginLink(userId, userSecret, {
      broker:            body.broker,
      reconnect:         body.reconnect,
      immediateRedirect: true,
      customRedirect:    `${appUrl}/dashboard/accounts?connected=snaptrade`,
    })
    return NextResponse.json({ redirectURI: result.redirectURI })
  } catch (err) {
    if (err instanceof SnapTradeError && err.code === '1083') {
      return NextResponse.json({ error: 'Your saved brokerage connection credentials are no longer accepted. The app owner needs to restore your SnapTrade profile secret. Your existing connections have been preserved.', code: 'SNAPTRADE_PROFILE_RECOVERY_REQUIRED' }, { status: 409 })
    }
    console.error('SnapTrade connection portal unavailable.', err instanceof SnapTradeError ? {status: err.status, code: err.code} : {type: 'connection failure'})
    return NextResponse.json(
      { error: 'The brokerage connection provider is unavailable. Please try again shortly.' },
      { status: 503 },
    )
  }
}
