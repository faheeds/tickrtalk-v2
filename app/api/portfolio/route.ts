import { getUserAlpaca } from '@/lib/getUserAlpaca'
import { supabaseAdmin }  from '@/lib/supabase'
import { NextResponse }   from 'next/server'

export async function GET() {
  const { alpaca, userId, error } = await getUserAlpaca()
  if (error) return error

  const [account, positions, orders, dbPortfolio] = await Promise.allSettled([
    alpaca!.getAccount(),
    alpaca!.getPositions(),
    alpaca!.getOrders('open'),
    supabaseAdmin.from('portfolios').select('data').eq('user_id', userId!).single(),
  ])

  return NextResponse.json({
    account:   account.status   === 'fulfilled' ? account.value   : null,
    positions: positions.status === 'fulfilled' ? positions.value : [],
    orders:    orders.status    === 'fulfilled' ? orders.value    : [],
    journal:   dbPortfolio.status === 'fulfilled' ? dbPortfolio.value?.data?.data?.journal ?? [] : [],
    params:    dbPortfolio.status === 'fulfilled' ? dbPortfolio.value?.data?.data?.params  ?? {} : {},
  })
}
