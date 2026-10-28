/**
 * GET /api/snaptrade/debug
 * Diagnostic endpoint — tests every known SnapTrade activity/order/transaction endpoint.
 * REMOVE before going fully public.
 */
import { requireUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { listAccounts, listAuthorizations } from '@/lib/snaptrade'
import { NextResponse } from 'next/server'

const BASE         = 'https://api.snaptrade.com/api/v1'
const CLIENT_ID    = process.env.SNAPTRADE_CLIENT_ID    ?? ''
const CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY ?? ''

import { createHmac } from 'crypto'

function canonicalJson(obj: unknown): string {
  const allKeys: string[] = []
  const seen: Record<string, null> = {}
  JSON.stringify(obj, function (key, value) {
    if (!(key in seen)) { allKeys.push(key); seen[key] = null }
    return value
  })
  allKeys.sort()
  return JSON.stringify(obj, allKeys)
}

function sign(fullPath: string, queryString: string, body: unknown): string {
  const sig = canonicalJson({ content: body ?? null, path: fullPath, query: queryString })
  return createHmac('sha256', CONSUMER_KEY).update(sig).digest('base64')
}

async function snapGet(path: string, extraQ: Record<string, string> = {}): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const ts = Math.floor(Date.now() / 1000).toString()
  const params = new URLSearchParams({ clientId: CLIENT_ID, timestamp: ts, ...extraQ })
  const qs = params.toString()
  const fullPath = `/api/v1${path}`
  const sig = sign(fullPath, qs, null)
  try {
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { 'Content-Type': 'application/json', Signature: sig },
    })
    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = text }
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : text.slice(0, 200) }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message }
  }
}

function fiveYearsAgo() {
  const d = new Date(); d.setFullYear(d.getFullYear() - 5)
  return d.toISOString().slice(0, 10)
}

export async function GET() {
  if (process.env.ENABLE_BROKER_DEBUG !== 'true') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(process.env.OWNER_USER_IDS ?? '').split(',').map(id => id.trim()).includes(userId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: user } = await supabaseAdmin
    .from('users').select('snaptrade_user_secret').eq('id', userId).single()
  if (!user?.snaptrade_user_secret) return NextResponse.json({ error: 'no_secret' })

  let userSecret: string
  try { userSecret = decrypt(user.snaptrade_user_secret) }
  catch (e) { return NextResponse.json({ error: 'decrypt_failed', msg: (e as Error).message }) }

  const q = { userId, userSecret }
  const startDate = fiveYearsAgo()
  const endDate   = new Date().toISOString().slice(0, 10)

  // 1. Accounts
  let accounts: Awaited<ReturnType<typeof listAccounts>> = []
  try { accounts = await listAccounts(userId, userSecret) } catch {}
  const accountIds = accounts.map(a => a.id)

  // 2. Global endpoints
  const [globalActivities, globalActivitiesWithAccounts] = await Promise.all([
    snapGet('/activities', { ...q, startDate, endDate }),
    accountIds.length
      ? snapGet('/activities', { ...q, startDate, endDate, accounts: accountIds.join(',') })
      : Promise.resolve({ ok: true, status: 200, data: 'skipped (no accounts)' }),
  ])

  // 3. Per-account endpoints — test every variant for each account
  const perAccountResults = await Promise.all(
    accounts.map(async acc => {
      const aq = { ...q }
      const [
        activities,
        orders,
        transactions,
        recentOrders,
      ] = await Promise.all([
        snapGet(`/accounts/${acc.id}/activities`, { ...aq, startDate, endDate }),
        snapGet(`/accounts/${acc.id}/orders`,     { ...aq, state: 'all' }),
        snapGet(`/accounts/${acc.id}/transactions`, { ...aq, startDate, endDate }),
        snapGet(`/accounts/${acc.id}/recentOrders`, aq),
      ])

      return {
        accountId:   acc.id,
        accountName: acc.name,
        institution: acc.institution_name,
        endpoints: {
          'GET /accounts/{id}/activities':   { status: activities.status,   count: Array.isArray(activities.data) ? activities.data.length : null,   error: activities.error,   sample: Array.isArray(activities.data)   ? activities.data.slice(0, 2)   : activities.data },
          'GET /accounts/{id}/orders':       { status: orders.status,       count: Array.isArray(orders.data)     ? orders.data.length     : null,   error: orders.error,       sample: Array.isArray(orders.data)       ? orders.data.slice(0, 2)       : orders.data },
          'GET /accounts/{id}/transactions': { status: transactions.status, count: Array.isArray(transactions.data) ? transactions.data.length : null, error: transactions.error, sample: Array.isArray(transactions.data) ? transactions.data.slice(0, 2) : transactions.data },
          'GET /accounts/{id}/recentOrders': { status: recentOrders.status, count: Array.isArray(recentOrders.data) ? recentOrders.data.length : null, error: recentOrders.error, sample: Array.isArray(recentOrders.data) ? recentOrders.data.slice(0, 2) : recentOrders.data },
        },
      }
    })
  )

  // 4. Authorizations (to check broker degraded status)
  const authsResult = await listAuthorizations(userId, userSecret).catch(e => ({ error: (e as Error).message }))

  return NextResponse.json({
    userId,
    startDate,
    endDate,
    accountCount: accounts.length,
    accounts: accounts.map(a => ({ id: a.id, name: a.name, institution: a.institution_name })),
    authorizations: authsResult,
    globalEndpoints: {
      'GET /activities':                    { status: globalActivities.status,             count: Array.isArray(globalActivities.data)             ? globalActivities.data.length             : null, error: globalActivities.error },
      'GET /activities (with accountIds)':  { status: globalActivitiesWithAccounts.status, count: Array.isArray(globalActivitiesWithAccounts.data) ? globalActivitiesWithAccounts.data.length : null, error: (globalActivitiesWithAccounts as { error?: string }).error },
    },
    perAccountResults,
  })
}
