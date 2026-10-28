import { supabaseAdmin } from '@/lib/supabase'
import { encrypt }       from '@/lib/crypto'
import axios             from 'axios'
import { NextResponse }  from 'next/server'

const SCHWAB_CLIENT_ID     = process.env.SCHWAB_CLIENT_ID!
const SCHWAB_CLIENT_SECRET = process.env.SCHWAB_CLIENT_SECRET!
const SCHWAB_TOKEN_URL     = 'https://api.schwabapi.com/v1/oauth/token'
const REDIRECT_URI         = `${process.env.NEXT_PUBLIC_APP_URL}/api/brokerage/schwab/callback`

export async function GET(req: Request) {
  const url    = new URL(req.url)
  const code   = url.searchParams.get('code')
  const userId = url.searchParams.get('state')   // set during authorize
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  if (!code || !userId) return NextResponse.redirect(`${appUrl}/dashboard/settings?error=schwab_denied`)

  try {
    const tokenRes = await axios.post(SCHWAB_TOKEN_URL,
      new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      { auth: { username: SCHWAB_CLIENT_ID, password: SCHWAB_CLIENT_SECRET } }
    )
    const { access_token, refresh_token, expires_in } = tokenRes.data

    await supabaseAdmin.from('brokerage_connections').upsert({
      user_id:                userId,
      broker:                 'schwab',
      access_token_encrypted:  encrypt(access_token),
      refresh_token_encrypted: encrypt(refresh_token),
      token_expires_at:        new Date(Date.now() + expires_in * 1000).toISOString(),
      paper_mode:              false,
      is_active:               true,
      label:                   'Schwab Live',
    }, { onConflict: 'user_id,broker,label' })

    return NextResponse.redirect(`${appUrl}/dashboard/settings?connected=schwab`)
  } catch {
    return NextResponse.redirect(`${appUrl}/dashboard/settings?error=schwab_token_failed`)
  }
}
