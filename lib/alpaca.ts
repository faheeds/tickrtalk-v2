/**
 * TickrTalk — Per-User Alpaca REST Client (TypeScript)
 *
 * Wraps Alpaca's v2 REST API for:
 *  - Account & position info
 *  - Real-time quotes & historical bars
 *  - Paper/live order execution
 *  - Asset screening (liquidity filter)
 *
 * Uses fetch directly — avoids the broken lodash dep in the Alpaca SDK on Node 22.
 */

export interface AlpacaCreds {
  apiKey: string
  apiSecret: string
  paper?: boolean
}

interface AlpacaRequestOptions {
  params?: Record<string, string | number | boolean>
  body?: unknown
}

// ─── HTTP HELPERS ─────────────────────────────────────────────────────────────

function getBaseUrl(paper: boolean, data = false) {
  if (data) return 'https://data.alpaca.markets'
  return paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'
}

function getHeaders(creds: AlpacaCreds) {
  return {
    'APCA-API-KEY-ID': creds.apiKey,
    'APCA-API-SECRET-KEY': creds.apiSecret,
    'Content-Type': 'application/json',
  }
}

async function alpacaFetch(
  url: string,
  headers: Record<string, string>,
  method = 'GET',
  body?: unknown
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as { message?: string }).message || res.statusText)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

function buildUrl(base: string, path: string, params?: Record<string, string | number | boolean>) {
  const url = new URL(base + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

// ─── CLIENT FACTORY ───────────────────────────────────────────────────────────

export function createAlpacaClient(creds: AlpacaCreds) {
  const paper = creds.paper !== false // default true
  const headers = getHeaders(creds)
  const feed = 'iex'

  async function tradeGet(path: string, params?: Record<string, string | number | boolean>) {
    return alpacaFetch(buildUrl(getBaseUrl(paper), path, params), headers)
  }

  async function tradePost(path: string, body: unknown) {
    return alpacaFetch(buildUrl(getBaseUrl(paper), path), headers, 'POST', body)
  }

  async function tradeDelete(path: string) {
    return alpacaFetch(buildUrl(getBaseUrl(paper), path), headers, 'DELETE')
  }

  async function dataGet(path: string, params?: Record<string, string | number | boolean>) {
    return alpacaFetch(buildUrl(getBaseUrl(paper, true), path, params), headers)
  }

  // ─── ACCOUNT ──────────────────────────────────────────────────────────────

  async function getAccount() {
    const a = await tradeGet('/v2/account')
    const equity = parseFloat(a.equity)
    const lastEquity = parseFloat(a.last_equity)
    return {
      id: a.id as string,
      status: a.status as string,
      buyingPower: +parseFloat(a.buying_power).toFixed(2),
      cash: +parseFloat(a.cash).toFixed(2),
      portfolioValue: +parseFloat(a.portfolio_value).toFixed(2),
      equity: +equity.toFixed(2),
      lastEquity: +lastEquity.toFixed(2),
      dayPnl: +(equity - lastEquity).toFixed(2),
      dayPnlPct: +((equity - lastEquity) / lastEquity * 100).toFixed(2),
      patternDayTrader: a.pattern_day_trader as boolean,
      tradingBlocked: a.trading_blocked as boolean,
      paper,
      mode: paper ? 'PAPER' : 'LIVE',
    }
  }

  // ─── POSITIONS ────────────────────────────────────────────────────────────

  async function getPositions() {
    const positions = await tradeGet('/v2/positions')
    return (positions as Record<string, string | number>[]).map(p => ({
      symbol: p.symbol as string,
      qty: +parseFloat(p.qty as string).toFixed(6),
      side: p.side as string,
      avgEntryPrice: +parseFloat(p.avg_entry_price as string).toFixed(2),
      currentPrice: +parseFloat(p.current_price as string).toFixed(2),
      marketValue: +parseFloat(p.market_value as string).toFixed(2),
      costBasis: +parseFloat(p.cost_basis as string).toFixed(2),
      unrealizedPnl: +parseFloat(p.unrealized_pl as string).toFixed(2),
      unrealizedPct: +((p.unrealized_plpc as number) * 100).toFixed(2),
      todayPnl: +parseFloat(p.unrealized_intraday_pl as string).toFixed(2),
      todayPct: +((p.unrealized_intraday_plpc as number) * 100).toFixed(2),
    }))
  }

  // ─── ORDERS ───────────────────────────────────────────────────────────────

  async function getOrders(status = 'open') {
    return tradeGet('/v2/orders', { status, limit: 100, direction: 'desc' })
  }

  interface PlaceOrderOptions {
    symbol: string
    qty: number
    side: 'buy' | 'sell'
    limitPrice?: number
    stopPrice?: number
    targetPrice?: number
    strategy?: string
  }

  async function placeOrder({
    symbol,
    qty,
    side,
    limitPrice,
    stopPrice,
    targetPrice,
    strategy = 'ALGO',
  }: PlaceOrderOptions) {
    if (side === 'sell') {
      const positions = await getPositions().catch(() => [])
      const held = positions.find(p => p.symbol === symbol)
      if (!held) {
        return { ok: false, message: `Cash-only account: no position in ${symbol} to sell (no shorting).` }
      }
      qty = Math.min(Math.round(qty), held.qty)
    }

    if (side === 'buy' && limitPrice) {
      const account = await getAccount().catch(() => null)
      const cash = account?.cash ?? null
      if (cash !== null) {
        const maxQty = Math.floor(cash / limitPrice)
        qty = Math.min(Math.round(qty), Math.max(1, maxQty))
      }
    }

    const hasBracket = stopPrice && targetPrice
    const body = {
      symbol,
      qty: Math.max(1, Math.round(qty)),
      side,
      type: limitPrice ? 'limit' : 'market',
      time_in_force: 'day',
      ...(limitPrice && { limit_price: limitPrice.toFixed(2) }),
      ...(hasBracket && {
        order_class: 'bracket',
        stop_loss: { stop_price: stopPrice!.toFixed(2) },
        take_profit: { limit_price: targetPrice!.toFixed(2) },
      }),
      client_order_id: `tickrtalk_${strategy}_${Date.now()}`,
    }

    try {
      const order = await tradePost('/v2/orders', body)
      return { ok: true, orderId: order.id, status: order.status, order }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  async function cancelOrder(orderId: string) {
    try {
      await tradeDelete(`/v2/orders/${orderId}`)
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  async function cancelAllOrders() {
    try {
      await tradeDelete('/v2/orders')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  async function closePosition(symbol: string) {
    try {
      const order = await tradeDelete(`/v2/positions/${symbol}`)
      return { ok: true, order }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  async function closeAllPositions() {
    try {
      await tradeDelete('/v2/positions?cancel_orders=true')
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  // ─── MARKET DATA ──────────────────────────────────────────────────────────

  async function getBars(symbol: string, months = 18, timeframe = '1Day') {
    const end = new Date()
    const start = new Date()
    start.setMonth(start.getMonth() - months)

    try {
      const data = await dataGet(`/v2/stocks/${symbol}/bars`, {
        timeframe,
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
        feed,
        limit: 10000,
      })

      let bars: Record<string, number | string>[] = data.bars || []
      let next = data.next_page_token
      while (next) {
        const page = await dataGet(`/v2/stocks/${symbol}/bars`, {
          timeframe,
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
          feed,
          limit: 10000,
          page_token: next,
        })
        bars = bars.concat(page.bars || [])
        next = page.next_page_token
      }

      return bars
        .filter(b => b.c && b.o && b.h && b.l)
        .sort((a, b) => new Date(a.t as string).getTime() - new Date(b.t as string).getTime())
        .map(b => ({
          date: new Date(b.t as string),
          open: b.o as number,
          high: b.h as number,
          low: b.l as number,
          close: b.c as number,
          volume: b.v as number,
          vwap: (b.vw as number) || null,
        }))
    } catch {
      return []
    }
  }

  async function getIntradayBars(symbol: string, timeframe = '5Min', days = 5) {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - days)

    try {
      const data = await dataGet(`/v2/stocks/${symbol}/bars`, {
        timeframe,
        start: start.toISOString(),
        end: end.toISOString(),
        feed,
        limit: 10000,
      })

      return ((data.bars || []) as Record<string, number | string>[])
        .filter(b => b.c)
        .sort((a, b) => new Date(a.t as string).getTime() - new Date(b.t as string).getTime())
        .map(b => ({
          date: new Date(b.t as string),
          open: b.o as number,
          high: b.h as number,
          low: b.l as number,
          close: b.c as number,
          volume: b.v as number,
          vwap: (b.vw as number) || null,
        }))
    } catch {
      return []
    }
  }

  async function getQuote(symbol: string) {
    try {
      const [quoteRes, snapRes] = await Promise.allSettled([
        dataGet(`/v2/stocks/${symbol}/quotes/latest`, { feed }),
        dataGet(`/v2/stocks/${symbol}/snapshots`, { feed }),
      ])

      const q = quoteRes.status === 'fulfilled' ? quoteRes.value?.quote : null
      const s = snapRes.status === 'fulfilled' ? snapRes.value?.[symbol] : null

      const price = s?.latestTrade?.p || s?.minuteBar?.c || q?.ap || null
      const bid = q?.bp || null
      const ask = q?.ap || null
      const spread = bid && ask ? +(ask - bid).toFixed(4) : null

      return {
        symbol,
        price: price ? +parseFloat(price).toFixed(2) : null,
        bid,
        ask,
        spread,
        open: s?.dailyBar?.o || null,
        high: s?.dailyBar?.h || null,
        low: s?.dailyBar?.l || null,
        prevClose: s?.prevDailyBar?.c || null,
        changesPct:
          s?.dailyBar && s?.prevDailyBar
            ? +((s.dailyBar.c - s.prevDailyBar.c) / s.prevDailyBar.c * 100).toFixed(2)
            : null,
        volume: s?.dailyBar?.v || null,
        vwap: s?.dailyBar?.vw || null,
        timestamp: new Date().toISOString(),
      }
    } catch {
      return null
    }
  }

  async function getBulkQuotes(symbols: string[]) {
    const results: Record<string, ReturnType<typeof getQuote> extends Promise<infer T> ? T : never> = {}
    const CHUNK = 100

    for (let i = 0; i < symbols.length; i += CHUNK) {
      const batch = symbols.slice(i, i + CHUNK)
      try {
        const data = await dataGet('/v2/stocks/snapshots', {
          symbols: batch.join(','),
          feed,
        })

        for (const [sym, s] of Object.entries(data as Record<string, Record<string, Record<string, number>>>)) {
          const price = s?.latestTrade?.p || s?.minuteBar?.c || null
          results[sym] = {
            symbol: sym,
            price: price ? +price.toFixed(2) : null,
            open: s?.dailyBar?.o || null,
            high: s?.dailyBar?.h || null,
            low: s?.dailyBar?.l || null,
            prevClose: s?.prevDailyBar?.c || null,
            changesPct:
              s?.dailyBar && s?.prevDailyBar
                ? +((s.dailyBar.c - s.prevDailyBar.c) / s.prevDailyBar.c * 100).toFixed(2)
                : null,
            volume: s?.dailyBar?.v || null,
            vwap: s?.dailyBar?.vw || null,
            timestamp: new Date().toISOString(),
            bid: null,
            ask: null,
            spread: null,
          } as never
        }
      } catch {}

      if (i + CHUNK < symbols.length) await new Promise(r => setTimeout(r, 200))
    }
    return results
  }

  // ─── SCREENING ────────────────────────────────────────────────────────────

  async function isLiquid(symbol: string, minVolume = 500_000, minPrice = 5) {
    try {
      const bars = await getBars(symbol, 3)
      if (bars.length < 20) return false
      const recent = bars.slice(-20)
      const avgVol = recent.reduce((s, b) => s + b.volume, 0) / recent.length
      const lastPrice = bars[bars.length - 1].close
      return avgVol >= minVolume && lastPrice >= minPrice
    } catch {
      return false
    }
  }

  async function getClock() {
    try {
      const c = await tradeGet('/v2/clock')
      return {
        isOpen: c.is_open as boolean,
        nextOpen: c.next_open as string,
        nextClose: c.next_close as string,
        timestamp: c.timestamp as string,
      }
    } catch {
      return null
    }
  }

  async function getCalendar(start: string, end: string) {
    try {
      return tradeGet('/v2/calendar', { start, end })
    } catch {
      return []
    }
  }

  // ─── ACCOUNT ACTIVITIES ───────────────────────────────────────────────────

  interface AlpacaActivity {
    id: string
    activity_type: string
    transaction_time: string
    symbol: string
    qty: string
    price: string
    side: 'buy' | 'sell'
    order_id: string
    cum_qty: string
    leaves_qty: string
    type: string
  }

  async function getActivities(activityType = 'FILL', afterDate?: string): Promise<AlpacaActivity[]> {
    const all: AlpacaActivity[] = []
    const params: Record<string, string | number | boolean> = {
      activity_type: activityType,
      direction: 'asc',
      page_size: 100,
    }
    if (afterDate) params.after = afterDate

    try {
      // Fetch up to 1000 activities (10 pages)
      for (let page = 0; page < 10; page++) {
        const data = await tradeGet(`/v2/account/activities/${activityType}`, params) as AlpacaActivity[]
        if (!Array.isArray(data) || data.length === 0) break
        all.push(...data)
        if (data.length < 100) break
        // Use last id as page token (Alpaca uses id-based pagination for activities)
        const lastId = data[data.length - 1].id
        params.page_token = lastId
      }
    } catch (e) {
      console.error('getActivities error:', (e as Error).message)
    }
    return all
  }

  return {
    getAccount,
    getPositions,
    getOrders,
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    closePosition,
    closeAllPositions,
    getBars,
    getIntradayBars,
    getQuote,
    getBulkQuotes,
    isLiquid,
    getClock,
    getCalendar,
    getActivities,
  }
}

export type AlpacaClient = ReturnType<typeof createAlpacaClient>
