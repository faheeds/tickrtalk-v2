import { NextResponse } from 'next/server'
import { researchUser } from '@/lib/research/access'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function service(path: string, owner: string, method = 'GET', body?: unknown) {
  const endpoint = process.env.RESEARCH_API_URL
  const token = process.env.RESEARCH_API_KEY
  if (!endpoint || !token) return {status: 503, data: {error: 'TradingAgents is not connected. Configure the private research service.'}}
  try {
    const url = new URL(endpoint)
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Invalid service URL')
    url.pathname = url.pathname.replace(/\/$/, '') + path.split('?')[0]
    url.search = path.includes('?') ? path.slice(path.indexOf('?')) : ''
    const response = await fetch(url, {method, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Research-User': owner},
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(10000)})
    return {status: response.status, data: await response.json()}
  } catch { return {status: 503, data: {error: 'The TradingAgents service is unavailable. Check that it is running and try again.'}} }
}
async function handle(req: Request) {
  const owner = await researchUser(req)
  if (!owner) return NextResponse.json({error: 'Unauthorized'}, {status: 401})
  const id = new URL(req.url).searchParams.get('job')
  if (id && !/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({error: 'Invalid report ID.'}, {status: 400})
  if (req.method === 'GET' && !id && process.env.RESEARCH_RUNTIME!=='cloud') {
    const [health, history] = await Promise.all([service('/health', owner), service('/jobs', owner)])
    if (health.status !== 200 || history.status !== 200) return NextResponse.json({error: health.data.error ?? history.data.error}, {status: health.status !== 200 ? health.status : history.status})
    return NextResponse.json({health: health.data, jobs: history.data.jobs}, {headers: {'Cache-Control': 'no-store'}})
  }
  if (['DELETE', 'PATCH'].includes(req.method) && !id) return NextResponse.json({error: 'A report ID is required.'}, {status: 400})
  let body
  if (req.method === 'POST' || req.method === 'PATCH') {
    body = await req.json().catch(() => null)
    if (!body || (req.method === 'POST' && (typeof body.symbol !== 'string' || !/^[A-Z][A-Z0-9.-]{0,19}$/i.test(body.symbol)))) return NextResponse.json({error: 'Enter a valid stock symbol.'}, {status: 400})
    body = req.method === 'POST' ? {symbol: body.symbol.toUpperCase()} : {saved: body.saved}
  }
  if(process.env.RESEARCH_RUNTIME==='cloud'){
    if(process.env.VERCEL_ENV!=='production')return NextResponse.json({error:'Cloud research is restricted to production.'},{status:503})
    try{
      const {researchAction}=await import('@/services/research/cloud.mjs')
      const {start}=await import('workflow/api')
      const {researchAnalysis}=await import('@/workflows/research')
      const data=await researchAction(owner,req.method,id,body,{launch:(job:string)=>start(researchAnalysis,[job])})
      return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}})
    }catch(error){const status=error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'?error.status:503;return NextResponse.json({error:status===409?'You already have active research or the queue limit was reached.':'Cloud research is not available. Check its configuration and retry.'},{status})}
  }
  const result = await service(`/jobs${id ? `?id=${encodeURIComponent(id)}` : ''}`, owner, req.method, body)
  return NextResponse.json(result.data, {status: result.status, headers: {'Cache-Control': 'no-store'}})
}
export const GET = handle
export const POST = handle
export const DELETE = handle
export const PATCH = handle
