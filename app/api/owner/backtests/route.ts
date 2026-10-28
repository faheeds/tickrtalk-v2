import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { validateBacktestRequest } from '@/lib/backtests/contract.mjs'
import constituents from '@/services/paper/data/sp500.json'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function owner() {
  const { userId } = await auth()
  const allowed = (process.env.OWNER_USER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  return userId && allowed.includes(userId) ? userId : null
}

async function handle(request: Request) {
  const userId = await owner()
  if (!userId) return NextResponse.json({ error: 'Owner access required.' }, { status: 403 })
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ error: 'Cloud backtesting is available in the configured production workspace.' }, { status: 503 })
  }
  const jobId = new URL(request.url).searchParams.get('job')
  if (jobId && !/^[a-f0-9-]{36}$/i.test(jobId)) return NextResponse.json({ error: 'Invalid backtest ID.' }, { status: 400 })
  if (['GET', 'DELETE'].includes(request.method) && !jobId) {
    if (request.method === 'DELETE') return NextResponse.json({ error: 'A backtest ID is required.' }, { status: 400 })
  }
  try {
    const { backtestAction } = await import('@/services/vibe-backtest/cloud.mjs')
    const id = request.method === 'POST' ? randomUUID() : jobId
    let input
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null)
      input = { ...validateBacktestRequest(body, constituents.members.map(member => member.symbol)), id }
      const { start } = await import('workflow/api')
      const { vibeBacktest } = await import('@/workflows/vibe-backtest')
      const data = await backtestAction(userId, request.method, id, input, { launch: async (job: string) => { await start(vibeBacktest, [job]) } })
      return NextResponse.json(data, { status: 202, headers: { 'Cache-Control': 'no-store' } })
    }
    const data = await backtestAction(userId, request.method, id, undefined)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 503
    const message = error instanceof Error && status < 500 ? error.message : 'Backtesting is unavailable. Check the owner setup and retry.'
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export const GET = handle
export const POST = handle
export const DELETE = handle
