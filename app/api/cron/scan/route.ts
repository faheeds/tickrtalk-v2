import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ error: 'Legacy execution retired. Use the dedicated paper execution service.' }, { status: 410 })
}
