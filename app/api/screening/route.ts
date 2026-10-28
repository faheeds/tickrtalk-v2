import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import {savedScreenings,saveScreenings} from '@/lib/screening-store'
import type { Screening, ScreenStatus } from '@/lib/workspace/types'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const status = (s: unknown): ScreenStatus => s === 'pass' || s === 'review' || s === 'fail' ? s : 'unavailable'
type Raw = Record<string, unknown>
const record = (x: unknown): Raw => x && typeof x === 'object' ? x as Raw : {}
const text = (x: unknown) => typeof x === 'string' ? x : ''
function adaptScreening(raw: Raw, symbol: string): Screening {
  const v = record(raw.verdict), figures = record(raw.figures), segment = record(raw.segments)
  const ratios = Array.isArray(raw.ratios) ? raw.ratios.map(record) : []
  const normalized = status(v.cls ?? raw.status)
  const income = ratios.find(r => r.key === 'income')
  return {
    ticker: text(raw.symbol) || text(raw.ticker) || symbol, status: normalized,
    verdict: text(v.title) || text(raw.verdict) || 'Assessment unavailable', reason: text(v.reason) || 'Review the service result and source qualifications.',
    asOf: text(raw.generatedAt) || text(raw.asOf) || new Date().toISOString(),
    period: text(figures.bsDate) || text(figures.isDate) || undefined,
    source: 'AAOIFI screening service', sourceUrl: text(segment.filingUrl) || text(record(raw.tenK).filingUrl) || undefined,
    cached: raw.cached === true,
    qualification: normalized === 'pass' && status(income?.status) !== 'pass' ? 'The income test could not be verified. The original engine verdict is preserved.' : undefined,
    ratios: ratios.map(r => ({ key: text(r.key), label: text(r.title) || text(r.key), value: typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null, threshold: typeof r.threshold === 'number' ? r.threshold : 0, status: status(r.status) })),
  }
}
async function service(path: string, body?: unknown) {
  const base = process.env.AAOIFI_URL
  if (!base) throw new Error('AAOIFI screening is not configured yet. The owner needs to connect the screening service.')
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`)
  if (!['https:', 'http:'].includes(url.protocol) || (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')) throw new Error('The screening service URL must use HTTPS in production.')
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000), cache: 'no-store' })
  const result = await r.json()
  if (!r.ok) throw new Error('The screening provider could not assess this stock. Check the symbol or try again later.')
  return result
}
export async function GET(req: NextRequest) {
  const userId=await requireUser().catch(()=>null)
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  if(req.nextUrl.searchParams.get('saved')==='1'){try{return NextResponse.json({results:await savedScreenings(userId)},{headers:{'Cache-Control':'private, no-store'}})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Saved screening results are unavailable.'},{status:503})}}
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) return NextResponse.json({ error: 'Enter a valid stock symbol.' }, { status: 400 })
  try { const raw = await service(`api/screen?ticker=${encodeURIComponent(symbol)}`);const result=adaptScreening(raw,symbol);await saveScreenings(userId,[result]);return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}}) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Screening unavailable.' }, { status: 503 }) }
}
export async function POST(req: NextRequest) {
  const userId=await requireUser().catch(()=>null)
  if(!userId)return NextResponse.json({error:'Unauthorized'},{status:401})
  const body = await req.json().catch(() => null)
  if (!Array.isArray(body?.symbols) || body.symbols.length > 50 || !body.symbols.length || body.symbols.some((s: unknown) => typeof s !== 'string' || !/^[A-Z0-9.^=-]{1,20}$/i.test(s.trim()))) return NextResponse.json({ error: 'Provide 1 to 50 valid stock symbols.' }, { status: 400 })
  const symbols = [...new Set((body.symbols as string[]).map(s => s.trim().toUpperCase()))]
  try {
    const result = await service('api/screen/batch', { tickers: symbols })
    const rows = Array.isArray(result.results) ? result.results.map(record) : []
    const errors = rows.filter((r: Raw) => r.error)
    const assessments=rows.filter((r:Raw)=>!r.error).map((r:Raw)=>adaptScreening(r,text(r.ticker)))
    await saveScreenings(userId,assessments)
    return NextResponse.json({ results: assessments, errors: errors.map((r: Raw) => ({ ticker: text(r.ticker), error: 'Assessment unavailable.' })) })
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Screening unavailable.' }, { status: 503 }) }
}
