import { getUserAlpaca }  from '@/lib/getUserAlpaca'
import { supabaseAdmin }  from '@/lib/supabase'
import { getVerdictMap }  from '@/lib/halal'
import { requireUser }    from '@/lib/auth'
import { NextResponse }   from 'next/server'

// Yahoo Finance fallback (no auth required, ~15 min delayed)
async function getYahooQuotes(symbols: string[]) {
  const results: Record<string, {
    symbol: string; price: number | null; changesPct: number | null
    high: number | null; low: number | null; volume: number | null
    prevClose: number | null; open: number | null
    bid: null; ask: null; spread: null; vwap: null; timestamp: string
  }> = {}

  try {
    const joined = symbols.join(',')
    const url    = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}&lang=en-US&region=US`
    const res    = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return results

    const data  = await res.json()
    const items = (data?.quoteResponse?.result ?? []) as Array<Record<string, unknown>>

    for (const item of items) {
      const sym = item.symbol as string
      if (!sym) continue
      results[sym] = {
        symbol:     sym,
        price:      (item.regularMarketPrice         as number) ?? null,
        changesPct: (item.regularMarketChangePercent as number) ?? null,
        high:       (item.regularMarketDayHigh       as number) ?? null,
        low:        (item.regularMarketDayLow        as number) ?? null,
        volume:     (item.regularMarketVolume        as number) ?? null,
        prevClose:  (item.regularMarketPreviousClose as number) ?? null,
        open:       (item.regularMarketOpen          as number) ?? null,
        bid: null, ask: null, spread: null, vwap: null,
        timestamp: new Date().toISOString(),
      }
    }
  } catch {}

  return results
}

export async function GET() {
  const userId = await requireUser().catch(() => null)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: wl } = await supabaseAdmin
    .from('watchlists').select('symbols').eq('user_id', userId).single()
  const symbols: string[] = wl?.symbols ?? []
  if (!symbols.length) return NextResponse.json({ symbols: [], quotes: {}, verdicts: {}, source: 'none' })

  const verdictMap = getVerdictMap()
  const verdicts: Record<string, string> = {}
  for (const sym of symbols) verdicts[sym] = verdictMap[sym] ?? 'UNKNOWN'

  // Try Alpaca first (real-time)
  const { alpaca } = await getUserAlpaca()
  if (alpaca) {
    const quotes = await alpaca.getBulkQuotes(symbols)
    if (Object.keys(quotes).length > 0) {
      return NextResponse.json({ symbols, quotes, verdicts, source: 'alpaca' })
    }
  }

  // Fallback: Yahoo Finance (free, ~15-min delayed)
  const quotes = await getYahooQuotes(symbols)
  const src    = Object.keys(quotes).length > 0 ? 'yahoo' : 'none'
  return NextResponse.json({ symbols, quotes, verdicts, source: src })
}
