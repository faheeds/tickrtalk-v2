/**
 * Schwab (formerly TD Ameritrade) OAuth 2.0 flow.
 *
 * 1. GET /api/brokerage/schwab?action=authorize  → redirects to Schwab login
 * 2. Schwab redirects back to /api/brokerage/schwab/callback
 */
import { requireUser }   from '@/lib/auth'
import { NextResponse }  from 'next/server'

const SCHWAB_CLIENT_ID = process.env.SCHWAB_CLIENT_ID!
const SCHWAB_AUTH_URL  = 'https://api.schwabapi.com/v1/oauth/authorize'
const REDIRECT_URI     = `${process.env.NEXT_PUBLIC_APP_URL}/api/brokerage/schwab/callback`

export async function GET(req: Request) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const url = new URL(SCHWAB_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', SCHWAB_CLIENT_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('scope', 'readonly')
  url.searchParams.set('state', userId)   // use userId as state for callback

  return NextResponse.redirect(url.toString())
}
