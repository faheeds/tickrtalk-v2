import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { WebhookEvent } from '@clerk/nextjs/server'
import { supabaseAdmin } from '@/lib/supabase'
import { stripe } from '@/lib/stripe'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET
  if (!WEBHOOK_SECRET) return NextResponse.json({ error: 'Missing secret' }, { status: 500 })

  const headerPayload = await headers()
  const svix_id        = headerPayload.get('svix-id')
  const svix_timestamp = headerPayload.get('svix-timestamp')
  const svix_signature = headerPayload.get('svix-signature')

  if (!svix_id || !svix_timestamp || !svix_signature)
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })

  const payload = await req.json()
  const body    = JSON.stringify(payload)

  const wh  = new Webhook(WEBHOOK_SECRET)
  let event: WebhookEvent
  try {
    event = wh.verify(body, { 'svix-id': svix_id, 'svix-timestamp': svix_timestamp, 'svix-signature': svix_signature }) as WebhookEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'user.created') {
    const { id, email_addresses } = event.data
    const email = email_addresses[0]?.email_address || ''

    // Create Stripe customer
    const customer = await stripe.customers.create({ email, metadata: { clerkId: id } })

    // Insert user in Supabase
    await supabaseAdmin.from('users').insert({
      id,
      email,
      stripe_customer_id: customer.id,
      subscription_status: 'trial',
      subscription_tier: 'basic',
      trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })

    // Seed empty portfolio + watchlist
    await supabaseAdmin.from('portfolios').insert({ user_id: id })
    await supabaseAdmin.from('watchlists').insert({ user_id: id })
    await supabaseAdmin.from('algo_params').insert({ user_id: id })
  }

  if (event.type === 'user.deleted') {
    const { id } = event.data
    if (id) await supabaseAdmin.from('users').delete().eq('id', id)
  }

  return NextResponse.json({ received: true })
}
