/**
 * SnapTrade API client
 *
 * Authentication (from docs.snaptrade.com/docs/request-signatures):
 *  1. Build payload: { content: <body|null>, path: "/api/v1/...", query: "clientId=...&timestamp=..." }
 *  2. Canonicalize: sort all keys alphabetically, no whitespace
 *  3. Sign: HMAC-SHA256(canonical_json, consumerKey_as_utf8_string), base64-encode result
 *  4. Send: clientId + timestamp as query params; signature in `Signature` header
 */
import { createHmac } from 'crypto'

const BASE         = 'https://api.snaptrade.com/api/v1'
const CLIENT_ID    = process.env.SNAPTRADE_CLIENT_ID    ?? ''
const CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY ?? ''

export class SnapTradeError extends Error {
  status: number
  code: string | null
  constructor(status: number, code: string | null) {
    super(`SnapTrade request failed (${status}${code ? `; code ${code}` : ''}).`)
    this.name = 'SnapTradeError'
    this.status = status
    this.code = code
  }
}

export function snapTradeConfigured(): boolean {
  return !!(process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY)
}

// ── Canonical JSON (keys sorted alphabetically at every nesting level) ────────
function canonicalJson(obj: unknown): string {
  // Collect every key name that appears anywhere in the object tree
  const allKeys: string[] = []
  const seen: Record<string, null> = {}
  JSON.stringify(obj, function (key, value) {
    if (!(key in seen)) { allKeys.push(key); seen[key] = null }
    return value
  })
  allKeys.sort()
  return JSON.stringify(obj, allKeys)
}

// ── Signature ─────────────────────────────────────────────────────────────────
function computeSignature(
  fullPath: string,   // e.g. /api/v1/snapTrade/registerUser
  queryString: string, // e.g. clientId=X&timestamp=Y  (no leading ?)
  body: unknown,       // request body object, or null for GET / empty
): string {
  const sigObject = {
    content: (body == null || body === '') ? null : body,
    path:    fullPath,
    query:   queryString,
  }
  const message = canonicalJson(sigObject)
  // Consumer key is used as-is (UTF-8 string), NOT base64-decoded
  return createHmac('sha256', CONSUMER_KEY)
    .update(message)
    .digest('base64')
}

// ── Core fetch helper ─────────────────────────────────────────────────────────
async function st(
  method:  string,
  path:    string,
  query?:  Record<string, string>,
  body?:   unknown,
  timeoutMs = 15000,
): Promise<unknown> {
  const timestamp = Math.floor(Date.now() / 1000).toString()

  // Build query string: clientId + timestamp FIRST (order matters for signing)
  const params = new URLSearchParams({ clientId: CLIENT_ID, timestamp })
  if (query) Object.entries(query).forEach(([k, v]) => params.set(k, v))
  const queryString = params.toString()

  const fullPath = `/api/v1${path}`
  const url      = `${BASE}${path}?${queryString}`

  // Signature covers the full payload (body, path, query)
  const signature = computeSignature(fullPath, queryString, body ?? null)

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Signature':    signature,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    const code = typeof payload?.code === 'string' || typeof payload?.code === 'number' ? String(payload.code) : null
    throw new SnapTradeError(res.status, code)
  }

  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : {}
}

// ── User management ──────────────────────────────────────────────────────────

export async function registerUser(
  userId: string,
): Promise<{ userId: string; userSecret: string }> {
  return st('POST', '/snapTrade/registerUser', undefined, { userId }) as Promise<{
    userId: string
    userSecret: string
  }>
}

export async function deleteUser(userId: string, userSecret: string): Promise<void> {
  await st('DELETE', '/snapTrade/deleteUser', { userId, userSecret })
}

/**
 * Returns the list of userId strings registered under this clientId.
 * On Personal plan this will have exactly 0 or 1 entries.
 */
export async function listUsers(): Promise<string[]> {
  return st('GET', '/snapTrade/listUsers') as Promise<string[]>
}

// ── OAuth portal ──────────────────────────────────────────────────────────────

export interface LoginResponse {
  redirectURI: string
}

export async function generateLoginLink(
  userId: string,
  userSecret: string,
  opts: {
    broker?:            string
    reconnect?:         string
    immediateRedirect?: boolean
    customRedirect?:    string
    connectionType?:    'read'
    darkMode?:          boolean
  } = {},
): Promise<LoginResponse> {
  // Only include non-null fields in body so content doesn't have undefined values
  const bodyObj: Record<string, unknown> = {}
  if (opts.broker)           bodyObj.broker            = opts.broker
  if (opts.reconnect)        bodyObj.reconnect         = opts.reconnect
  if (opts.customRedirect)   bodyObj.customRedirect    = opts.customRedirect
  bodyObj.immediateRedirect = opts.immediateRedirect ?? true
  bodyObj.connectionType = opts.connectionType ?? 'read'
  bodyObj.darkMode = opts.darkMode ?? true

  return st('POST', '/snapTrade/login', { userId, userSecret }, bodyObj) as Promise<LoginResponse>
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export interface SnapTradeAccount {
  id:                      string
  brokerage_authorization: string
  name:                    string
  number:                  string
  institution_name:        string
  meta: { type: string; status: string }
  balance?: { total?: {amount:number;currency:string}|null }
  sync_status?: {holdings?:{holdings_unavailable?:boolean};transactions?:{initial_sync_completed?:boolean}}
}

export async function listAccounts(
  userId: string,
  userSecret: string,
): Promise<SnapTradeAccount[]> {
  return st('GET', '/accounts', { userId, userSecret }) as Promise<SnapTradeAccount[]>
}

// ── Authorizations ────────────────────────────────────────────────────────────

export interface SnapTradeAuthorization {
  id:           string
  created_date: string
  updated_date: string
  brokerage: {
    id:           string
    name:         string
    display_name: string
    logo_url:     string
    status:       string
  }
}

export async function listAuthorizations(
  userId: string,
  userSecret: string,
): Promise<SnapTradeAuthorization[]> {
  return st('GET', '/authorizations', { userId, userSecret }) as Promise<SnapTradeAuthorization[]>
}

export async function deleteAuthorization(
  userId: string,
  userSecret: string,
  authorizationId: string,
): Promise<void> {
  await st('DELETE', `/authorizations/${authorizationId}`, { userId, userSecret })
}

// ── Holdings / Open Positions ─────────────────────────────────────────────────

export interface SnapTradePosition {
  // Actual SnapTrade shape: position.symbol.symbol.symbol = ticker string
  // position.symbol        = the position wrapper
  // position.symbol.symbol = the security object { id, symbol, description, ... }
  // position.symbol.symbol.symbol = the ticker string e.g. "XRP"
  symbol: {
    id?:         string
    description?: string
    symbol?: {
      id:          string
      symbol:      string   // ← ticker string lives HERE
      description: string
      currency?:   { code: string }
    }
  }
  units:                  number | null
  price:                  number | null
  open_pnl:               number | null
  // fractional_units equals units for crypto/fractional brokers — do NOT add to units
  fractional_units:       number | null
  average_purchase_price: number | null
}

/**
 * Returns open positions for a single account.
 * Endpoint: GET /accounts/{accountId}/positions
 * (replaces the deprecated GET /holdings which returns 410)
 */
export async function getAccountPositions(
  userId: string,
  userSecret: string,
  accountId: string,
): Promise<SnapTradePosition[]> {
  return st('GET', `/accounts/${accountId}/positions`, { userId, userSecret }) as Promise<SnapTradePosition[]>
}

// ── Activities ────────────────────────────────────────────────────────────────

export interface SnapTradeActivity {
  id:              string
  trade_date:      string
  settlement_date: string
  symbol: { id: string; symbol: string; description: string }
  currency: { code: string }
  // account is present in global /activities; absent in per-account /accounts/{id}/activities
  account?:     { id: string; name: string; institution_name: string }
  // institution is present in per-account /accounts/{id}/activities (top-level, not nested)
  institution?: string
  type:        string   // BUY | SELL | DIVIDEND | FEE | …
  amount:      number | null
  price:       number | null
  // NOTE: SELL units are returned as NEGATIVE values by the per-account endpoint
  units:       number | null
  description: string
}

export async function getActivities(
  userId: string,
  userSecret: string,
  opts: {
    startDate?: string
    endDate?:   string
    accounts?:  string[]
    types?:     string
  } = {},
): Promise<SnapTradeActivity[]> {
  const q: Record<string, string> = { userId, userSecret }
  if (opts.startDate)        q.startDate = opts.startDate
  if (opts.endDate)          q.endDate   = opts.endDate
  if (opts.accounts?.length) q.accounts  = opts.accounts.join(',')
  if (opts.types)            q.types     = opts.types
  return st('GET', '/activities', q) as Promise<SnapTradeActivity[]>
}

/**
 * Returns activities for a single account.
 * Endpoint: GET /accounts/{accountId}/activities
 * Use as fallback when global GET /activities returns 410 (deprecated for some accounts).
 */
export async function getAccountActivities(
  userId: string,
  userSecret: string,
  accountId: string,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<SnapTradeActivity[]> {
  const q: Record<string, string> = { userId, userSecret }
  if (opts.startDate) q.startDate = opts.startDate
  if (opts.endDate)   q.endDate   = opts.endDate
  const res = await st('GET', `/accounts/${accountId}/activities`, q)
  // The per-account endpoint returns { data: SnapTradeActivity[] } NOT a bare array
  if (res && typeof res === 'object' && !Array.isArray(res) &&
      Array.isArray((res as { data?: unknown }).data)) {
    return (res as { data: SnapTradeActivity[] }).data
  }
  return Array.isArray(res) ? (res as SnapTradeActivity[]) : []
}

/** Fetch every activity page needed for cash-flow reconciliation, with a bounded request budget. */
export async function getAccountActivityLedger(userId:string,userSecret:string,accountId:string,startDate:string):Promise<{activities:SnapTradeActivity[];complete:boolean}> {
  const activities:SnapTradeActivity[]=[]
  const deadline=Date.now()+35000
  for(let page=0;page<5;page++){
    const remaining=deadline-Date.now()
    if(remaining<1000)return {activities,complete:false}
    let result:{data?:SnapTradeActivity[];pagination?:{total?:number}}|SnapTradeActivity[]
    try{result=await st('GET',`/accounts/${accountId}/activities`,{userId,userSecret,startDate,limit:'1000',offset:String(page*1000)},undefined,Math.min(15000,remaining)) as typeof result}
    catch(error){if(activities.length)return {activities,complete:false};throw error}
    const rows=Array.isArray(result)?result:result.data??[]
    activities.push(...rows)
    const total=Array.isArray(result)?undefined:result.pagination?.total
    if(rows.length<1000||(total!==undefined&&activities.length>=total))return {activities,complete:true}
  }
  return {activities,complete:false}
}

export async function getAccountBalanceHistory(userId:string,userSecret:string,accountId:string):Promise<{currency:string;history:{date:string;total_value:string}[]}> {
  return st('GET',`/accounts/${accountId}/balanceHistory`,{userId,userSecret}) as Promise<{currency:string;history:{date:string;total_value:string}[]}>
}

export async function getAccountBalances(userId:string,userSecret:string,accountId:string):Promise<{currency:{code:string};cash:number|null}[]> {
  return st('GET',`/accounts/${accountId}/balances`,{userId,userSecret}) as Promise<{currency:{code:string};cash:number|null}[]>
}

// ── Orders (filled order history — fallback when activities is unavailable) ───

export interface SnapTradeOrder {
  brokerage_order_id: string
  status:             string   // 'FILLED' | 'EXECUTED' | 'CANCELLED' | 'PENDING' | …
  action:             string   // 'BUY' | 'SELL' | 'Buy' | 'Sell'
  order_type:         string   // 'Market' | 'Limit' | …
  // symbol is the same 2-level object as SnapTradeActivity (activity.symbol.symbol = ticker)
  symbol:             { id: string; symbol: string; description: string }
  total_quantity:     number | null
  filled_quantity:    number | null
  execution_price:    number | null
  limit_price:        number | null
  time_placed:        string
  time_executed:      string | null
  account:            { id: string; name: string; institution_name: string }
}

/**
 * Returns order history for a single account.
 * Endpoint: GET /accounts/{accountId}/orders
 * Used as a final fallback when both global and per-account /activities are unavailable.
 */
export async function getAccountOrders(
  userId: string,
  userSecret: string,
  accountId: string,
): Promise<SnapTradeOrder[]> {
  return st('GET', `/accounts/${accountId}/orders`, { userId, userSecret, state: 'all' }) as Promise<SnapTradeOrder[]>
}
