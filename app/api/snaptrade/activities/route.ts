/**
 * GET /api/snaptrade/activities
 *
 * Fetches BUY/SELL trade activities from all connected SnapTrade brokerages.
 * Query params: startDate (YYYY-MM-DD), endDate
 * Returns { trades: JournalTrade[], openPositions: [], brokers: string[] }
 */
import { requireUser } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getActivities, getAccountActivities, getAccountOrders, getAccountPositions, listAccounts, type SnapTradeActivity } from '@/lib/snaptrade'
import { getVerdict } from '@/lib/halal'
import { NextRequest, NextResponse } from 'next/server'
import type { JournalTrade } from '@/app/api/journal/route'

// Common crypto tickers — used as fallback when account name doesn't contain "crypto"
const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK',
  'LTC', 'BCH', 'MATIC', 'POL', 'SHIB', 'UNI', 'AAVE', 'ATOM', 'FIL',
  'ICP', 'ETC', 'XLM', 'ALGO', 'VET', 'THETA', 'TRX', 'EOS', 'ZEC',
  'DASH', 'XMR', 'NEAR', 'FTM', 'GRT', 'LRC', 'AXS', 'SAND', 'MANA',
  'APE', 'OP', 'ARB', 'SUI', 'SEI', 'INJ', 'TIA', 'RNDR', 'STX',
  'RUNE', 'OSMO', 'KAVA', 'HBAR', 'FLOW', 'CRV', 'COMP', 'MKR',
])

function fiveYearsAgo(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 5)
  return d.toISOString().slice(0, 10)
}

// Normalise broker-specific activity type strings to BUY / SELL
function normaliseType(raw: string | undefined): 'BUY' | 'SELL' | null {
  const t = (raw ?? '').toUpperCase().trim()
  if (['BUY', 'B', 'BOT', 'BUY TO OPEN', 'BTO'].includes(t)) return 'BUY'
  if (['SELL', 'S', 'SLD', 'SELL TO CLOSE', 'STC', 'SOLD'].includes(t)) return 'SELL'
  return null
}

export async function GET(req: NextRequest) {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('snaptrade_user_secret')
    .eq('id', userId)
    .single()

  if (!user?.snaptrade_user_secret) {
    return NextResponse.json({ trades: [], openPositions: [], registered: false })
  }

  let userSecret: string
  try {
    userSecret = decrypt(user.snaptrade_user_secret)
  } catch (e) {
    console.error('[snaptrade/activities] Failed to decrypt user secret:', e)
    return NextResponse.json({
      trades: [],
      openPositions: [],
      registered: false,
      staleSecret: true,
      error: 'SnapTrade credentials need to be refreshed. Please reconnect in Settings → Brokers.',
    })
  }

  const sp = req.nextUrl.searchParams
  const startDate = sp.get('startDate') ?? fiveYearsAgo()
  const endDate   = sp.get('endDate')   ?? new Date().toISOString().slice(0, 10)

  try {
    // 1. Get accounts so we can (a) pass explicit IDs to activities and (b) fetch per-account positions
    let accounts: Awaited<ReturnType<typeof listAccounts>> = []
    let accountsError: string | null = null
    try {
      accounts = await listAccounts(userId, userSecret)
    } catch (e) {
      accountsError = (e as Error).message ?? 'Failed to load accounts'
      console.error('[snaptrade/activities] listAccounts failed:', accountsError)
    }
    const accountIds = accounts.map(a => a.id)

    // 2. Fetch activities with 410 fallback, and per-account positions, fully in parallel.
    //    Activities gets its own .catch chain so 410 / any error never kills the position fetches.
    let activitiesError: string | null = null

    const activitiesPromise: Promise<SnapTradeActivity[]> = getActivities(userId, userSecret, {
      startDate,
      endDate,
      accounts: accountIds.length > 0 ? accountIds : undefined,
    }).catch(async (err: Error) => {
      const msg = err.message ?? ''
      if (msg.includes('410')) {
        // Global /activities deprecated for this account — try per-account endpoint
        console.log('[snaptrade/activities] Global /activities → 410; falling back to per-account')
        const settled = await Promise.allSettled(
          accounts.map(acc =>
            getAccountActivities(userId, userSecret, acc.id, { startDate, endDate })
              .then(acts => acts.map(a => ({
                ...a,
                // Carry full account name (e.g. "Robinhood Crypto") so we can detect crypto later
                institution: a.institution ?? acc.name,
              })))
          )
        )
        return settled.flatMap(r => r.status === 'fulfilled' ? r.value : [])
      }
      activitiesError = msg
      console.error('[snaptrade/activities] activities fetch failed:', msg)
      return [] as SnapTradeActivity[]
    }) as Promise<SnapTradeActivity[]>

    const [activities, ...positionResults] = await Promise.all([
      activitiesPromise,
      ...accounts.map(acc =>
        getAccountPositions(userId, userSecret, acc.id)
          .then(positions => ({ account: acc, positions }))
          .catch(() => ({ account: acc, positions: [] })),
      ),
    ])

    // 2b. If both activities endpoints returned nothing, try per-account orders as final fallback
    let rawActivities = activities as SnapTradeActivity[]
    if (rawActivities.length === 0 && accountIds.length > 0) {
      console.log('[snaptrade/activities] activities empty — trying orders fallback')
      const orderSettled = await Promise.allSettled(
        accounts.map(acc => getAccountOrders(userId, userSecret, acc.id)
          .then(orders => ({ account: acc, orders }))
          .catch(() => ({ account: acc, orders: [] })))
      )
      for (const r of orderSettled) {
        if (r.status !== 'fulfilled') continue
        const { account, orders } = r.value
        for (const o of orders) {
          // Only include filled orders with a price and quantity
          const isFilled = ['FILLED', 'EXECUTED', 'PARTIAL', 'COMPLETED'].includes((o.status ?? '').toUpperCase())
          const qty   = o.filled_quantity ?? o.total_quantity ?? 0
          const price = o.execution_price ?? 0
          if (!isFilled || qty <= 0 || price <= 0) continue
          rawActivities.push({
            id:              o.brokerage_order_id,
            trade_date:      o.time_executed ?? o.time_placed,
            settlement_date: o.time_executed ?? o.time_placed,
            symbol:          o.symbol,
            currency:        { code: 'USD' },
            account:         account,
            type:            o.action?.toUpperCase().includes('BUY') ? 'BUY'
                           : o.action?.toUpperCase().includes('SELL') ? 'SELL'
                           : o.action ?? '',
            amount:          null,
            price,
            units:           qty,
            description:     o.order_type ?? '',
          })
        }
      }
      console.log(`[snaptrade/activities] orders fallback yielded ${rawActivities.length} activities`)
    }

    // Log what came back so Vercel logs show real data
    const typeSample = [...new Set(rawActivities.map(a => a.type).filter(Boolean))].slice(0, 20)
    console.log(`[snaptrade/activities] accounts=${accounts.length} activities=${rawActivities.length} types=${JSON.stringify(typeSample)}`)

    // 3. Sort ascending for FIFO lot matching
    const sorted = [...rawActivities].sort(
      (a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime(),
    )

    const lots: Record<string, { qty: number; price: number }[]> = {}
    const trades: JournalTrade[] = []
    const brokerSet = new Set<string>()

    for (const act of sorted) {
      const symbol = act.symbol?.symbol
      // Per-account /activities returns negative units for SELL — take absolute value
      const qty    = Math.abs(act.units ?? 0)
      const price  = act.price  ?? 0
      const type   = normaliseType(act.type)
      // Per-account endpoint has institution at top level; global endpoint nests it under account
      const broker = act.institution ?? act.account?.institution_name ?? 'SnapTrade'
      // Detect crypto: account name contains "crypto" OR symbol is a known crypto ticker
      const assetClass: 'CRYPTO' | 'STOCK' =
        act.institution?.toLowerCase().includes('crypto') || CRYPTO_TICKERS.has(symbol ?? '')
          ? 'CRYPTO' : 'STOCK'

      if (!symbol || qty <= 0 || price <= 0) continue
      if (!type) continue   // skip dividends, fees, etc.
      brokerSet.add(broker)

      if (type === 'BUY') {
        if (!lots[symbol]) lots[symbol] = []
        lots[symbol].push({ qty, price })
      } else if (type === 'SELL') {
        let remaining = qty
        let totalCost = 0
        let totalMatched = 0

        while (remaining > 0 && lots[symbol]?.length > 0) {
          const lot  = lots[symbol][0]
          const take = Math.min(lot.qty, remaining)
          totalCost    += take * lot.price
          totalMatched += take
          lot.qty      -= take
          remaining    -= take
          if (lot.qty === 0) lots[symbol].shift()
        }

        const avgEntry  = totalMatched > 0 ? +(totalCost / totalMatched).toFixed(4) : null
        const closedQty = qty - remaining
        const pnl       = avgEntry !== null ? +((price - avgEntry) * closedQty).toFixed(2) : null
        const pnlPct    =
          avgEntry !== null && avgEntry > 0
            ? +((price - avgEntry) / avgEntry * 100).toFixed(2)
            : null

        trades.push({
          id:         act.id,
          date:       act.trade_date.slice(0, 10),
          symbol,
          side:       'LONG',
          qty:        +closedQty.toFixed(4),
          entry:      avgEntry,
          exit:       +price.toFixed(4),
          pnl,
          pnlPct,
          halal:      getVerdict(symbol),
          broker,
          assetClass,
        } as JournalTrade & { broker: string })
      }
    }

    trades.reverse()

    // 4. Build open positions from per-account positions
    const openPositions: {
      symbol: string; qty: number; side: string; avgEntryPrice: number
      currentPrice: number; marketValue: number; unrealizedPnl: number
      unrealizedPct: number; halal: string; broker: string
      assetClass: 'CRYPTO' | 'STOCK'
    }[] = []

    for (const result of positionResults as { account: { name?: string; institution_name: string }; positions: { symbol?: { symbol?: { symbol?: string } }; units?: number | null; fractional_units?: number | null; price?: number | null; average_purchase_price?: number | null; open_pnl?: number | null }[] }[]) {
      const broker = result.account?.institution_name ?? 'SnapTrade'
      // Detect crypto accounts (e.g. "Robinhood Crypto Individual")
      const isCryptoAccount = result.account?.name?.toLowerCase().includes('crypto') ?? false
      for (const p of result.positions ?? []) {
        // Real SnapTrade shape: position.symbol.symbol.symbol = ticker string
        const symbol = p.symbol?.symbol?.symbol
        // fractional_units == units for crypto — just use units (already includes fractions)
        const qty    = p.units ?? 0
        if (!symbol || qty <= 0) continue

        const currentPrice  = p.price ?? 0
        const avgEntry      = p.average_purchase_price ?? 0
        const marketValue   = qty * currentPrice
        const unrealizedPnl = p.open_pnl ?? (avgEntry > 0 ? (currentPrice - avgEntry) * qty : 0)
        const unrealizedPct = avgEntry > 0 ? +((currentPrice - avgEntry) / avgEntry * 100).toFixed(2) : 0

        openPositions.push({
          symbol,
          qty:           +qty.toFixed(4),
          side:          'long',
          avgEntryPrice: +avgEntry.toFixed(2),
          currentPrice:  +currentPrice.toFixed(2),
          marketValue:   +marketValue.toFixed(2),
          unrealizedPnl: +unrealizedPnl.toFixed(2),
          unrealizedPct,
          halal:  getVerdict(symbol),
          broker,
          assetClass: isCryptoAccount || CRYPTO_TICKERS.has(symbol) ? 'CRYPTO' : 'STOCK',
        })
      }
    }

    console.log(`[snaptrade/activities] trades=${trades.length} openPositions=${openPositions.length}`)

    return NextResponse.json({
      trades,
      openPositions,
      registered: true,
      brokers: Array.from(brokerSet),
      total: trades.length,
      ...(accountsError    ? { error: `Could not load accounts: ${accountsError}` }    : {}),
      ...(activitiesError  ? { activitiesError }                                        : {}),
    })
  } catch (err) {
    console.error('SnapTrade activities error:', err)
    return NextResponse.json({
      trades: [],
      openPositions: [],
      registered: true,
      brokers: [],
      error: (err as Error).message ?? 'Failed to fetch activities',
    })
  }
}
