import { requireUser, getUserRecord } from '@/lib/auth'
import { NextResponse } from 'next/server'

export async function GET() {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await getUserRecord(userId)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({
    subscription_status: user.subscription_status,
    subscription_tier:   user.subscription_tier,
    trial_ends_at:       user.trial_ends_at,
  })
}
