import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json({ error: 'Account-wide reset retired. Close managed paper exposure from the owner console.' }, { status: 410 })
}
