import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'

export async function POST(req: Request) {
  const body = await req.text()
  const headersList = await headers()
  const sig = headersList.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const getClerkId = (sub: Stripe.Subscription) => sub.metadata?.clerkId as string | undefined

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const sub = await stripe.subscriptions.retrieve(session.subscription as string)
      const clerkId = session.metadata?.clerkId
      if (!clerkId) break
      const priceId = sub.items.data[0]?.price.id
      const tier = priceId === process.env.STRIPE_PRO_PRICE_ID ? 'pro' : 'basic'
      await supabaseAdmin.from('users').update({
        subscription_status: 'active',
        subscription_tier: tier,
        stripe_customer_id: session.customer as string,
      }).eq('id', clerkId)
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const clerkId = getClerkId(sub)
      if (!clerkId) break
      const priceId = sub.items.data[0]?.price.id
      const tier = priceId === process.env.STRIPE_PRO_PRICE_ID ? 'pro' : 'basic'
      const status = sub.status === 'active' ? 'active'
        : sub.status === 'past_due' ? 'past_due'
        : sub.status === 'canceled' ? 'canceled' : 'active'
      await supabaseAdmin.from('users').update({ subscription_status: status, subscription_tier: tier }).eq('id', clerkId)
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const clerkId = getClerkId(sub)
      if (!clerkId) break
      await supabaseAdmin.from('users').update({ subscription_status: 'canceled' }).eq('id', clerkId)
      break
    }
  }

  return NextResponse.json({ received: true })
}
