import { auth } from '@clerk/nextjs/server'
import { stripe, PLANS, PlanKey } from '@/lib/stripe'
import { getUserRecord } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  if (process.env.ENABLE_PAID_CHECKOUT !== 'true') return NextResponse.json({ error: 'Paid checkout is not enabled. Pricing and terms must be approved first.' }, { status: 503 })
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan } = await req.json() as { plan: PlanKey }
  if (!PLANS[plan]) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })

  const user = await getUserRecord(userId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tickrtalk-ebon.vercel.app'

  let session
  try {
    session = await stripe.checkout.sessions.create({
    customer: user?.stripe_customer_id || undefined,
    customer_email: user?.stripe_customer_id ? undefined : user?.email,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: PLANS[plan].priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 30,
      metadata: { clerkId: userId },
    },
    metadata: { clerkId: userId },
      success_url: `${appUrl}/dashboard?upgraded=1`,
      cancel_url:  `${appUrl}/dashboard/settings?tab=billing`,
    })
  } catch (e) {
    console.error('Stripe checkout error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  return NextResponse.json({ url: session.url })
}
