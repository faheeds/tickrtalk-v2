import { auth } from '@clerk/nextjs/server'
import { stripe } from '@/lib/stripe'
import { getUserRecord } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getUserRecord(userId)
  if (!user?.stripe_customer_id) return NextResponse.json({ error: 'No billing account' }, { status: 400 })

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings?tab=billing`,
  })

  return NextResponse.json({ url: session.url })
}
