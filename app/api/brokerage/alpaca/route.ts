import { requireUser }      from '@/lib/auth'
import { supabaseAdmin }    from '@/lib/supabase'
import { encrypt }          from '@/lib/crypto'
import { createAlpacaClient } from '@/lib/alpaca'
import { NextResponse }     from 'next/server'

// POST — save or update Alpaca credentials
export async function POST(req: Request) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { apiKey, apiSecret, paper = true } = await req.json()
  if (!apiKey || !apiSecret)
    return NextResponse.json({ error: 'apiKey and apiSecret required' }, { status: 400 })

  // Verify credentials actually work before saving
  const client = createAlpacaClient({ apiKey, apiSecret, paper })
  let account = null
  let testError = 'Unknown error'
  try {
    account = await client.getAccount()
  } catch (e) {
    testError = (e as Error).message || String(e)
    console.error('Alpaca connection test failed:', testError)
  }
  if (!account)
    return NextResponse.json({ error: `Invalid Alpaca credentials — ${testError}` }, { status: 422 })

  const row = {
    user_id:              userId,
    broker:               'alpaca',
    api_key_encrypted:    encrypt(apiKey),
    api_secret_encrypted: encrypt(apiSecret),
    account_id:           account.id || null,
    paper_mode:           paper,
    is_active:            true,
    label:                paper ? 'Paper' : 'Live',
  }

  const { error: dbError } = await supabaseAdmin
    .from('brokerage_connections')
    .upsert(row, { onConflict: 'user_id,broker,label' })

  if (dbError) {
    console.error('Failed to save Alpaca connection:', dbError)
    return NextResponse.json(
      { error: `Failed to save connection: ${dbError.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, accountStatus: account.status, equity: account.equity, paper })
}

// GET — return masked connection status
export async function GET() {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabaseAdmin
    .from('brokerage_connections')
    .select('id, broker, account_id, paper_mode, label, is_active, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ connections: data ?? [] })
}

// DELETE — remove a connection
export async function DELETE(req: Request) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  await supabaseAdmin.from('brokerage_connections').delete().eq('id', id).eq('user_id', userId)
  return NextResponse.json({ ok: true })
}
