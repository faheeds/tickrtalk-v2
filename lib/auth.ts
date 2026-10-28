import { auth, currentUser } from '@clerk/nextjs/server'
import { supabaseAdmin } from './supabase'

export async function requireUser() {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')

  // Ensure user exists in Supabase (idempotent — safe to call every request)
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .single()

  if (!existing) {
    const clerkUser = await currentUser()
    const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''
    await supabaseAdmin.from('users').upsert({
      id: userId,
      email,
      subscription_status: 'trial',
      subscription_tier: 'basic',
      trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'id', ignoreDuplicates: true })
  }

  return userId
}

export async function getUserRecord(userId: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}

export async function isProUser(userId: string): Promise<boolean> {
  const user = await getUserRecord(userId)
  if (!user) return false
  if (user.subscription_tier === 'pro' && user.subscription_status === 'active') return true
  // Also allow during trial for all tiers — trial users get Pro features
  if (user.subscription_status === 'trial' && new Date(user.trial_ends_at) > new Date()) return true
  return false
}

export async function getActiveBrokerConnection(userId: string, broker = 'alpaca') {
  // Use order+limit instead of .single() so multiple rows (e.g. old 'Default'
  // label + new 'Paper' label) don't cause .single() to return null.
  const { data } = await supabaseAdmin
    .from('brokerage_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('broker', broker)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}
