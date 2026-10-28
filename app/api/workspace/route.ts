import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { decrypt } from '@/lib/crypto'
import { createAlpacaClient } from '@/lib/alpaca'
import { getAccountActivityLedger, getAccountBalanceHistory, getAccountBalances, getAccountPositions, listAccounts } from '@/lib/snaptrade'
import { matchFills } from '@/lib/workspace/finance.mjs'
import {currentAccountValue,normalizeCapital} from '@/lib/workspace/capital.mjs'
import {nativeAccountRows} from '@/lib/workspace/currencies.mjs'
import type { Account, Holding, Trade } from '@/lib/workspace/types'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(req:Request) {
 const nativeCurrencies=new URL(req.url).searchParams.get('currencies')==='native'
 const userId=await requireUser().catch(()=>null)
 if(!userId) return NextResponse.json({error:'Unauthorized'},{status:401})
 const holdings:Holding[]=[],accounts:Account[]=[],trades:Trade[]=[],warnings:string[]=[]
 const from=new Date(); from.setFullYear(from.getFullYear()-5)
 const displayStart=new Date();displayStart.setFullYear(displayStart.getFullYear()-2)
 const [{data:user},{data:connections}]=await Promise.all([
  supabaseAdmin.from('users').select('snaptrade_user_secret').eq('id',userId).maybeSingle(),
  supabaseAdmin.from('brokerage_connections').select('*').eq('user_id',userId).eq('is_active',true).eq('broker','alpaca').order('created_at',{ascending:false}),
 ])
 let snapAccounts:Awaited<ReturnType<typeof listAccounts>>=[]
 if(user?.snaptrade_user_secret){
  try{
   const secret=decrypt(user.snaptrade_user_secret)
   snapAccounts=await listAccounts(userId,secret)
   await Promise.all(snapAccounts.map(async a=>{
    const [pos,activity,history,cash]=await Promise.allSettled([getAccountPositions(userId,secret,a.id),getAccountActivityLedger(userId,secret,a.id,from.toISOString().slice(0,10)),getAccountBalanceHistory(userId,secret,a.id),/^zerodha$/i.test(a.institution_name??'')?getAccountBalances(userId,secret,a.id):Promise.resolve([])])
    const rows=pos.status==='fulfilled'?pos.value:[]
    const fills=activity.status==='fulfilled'?activity.value.activities:[]
    const broker=a.institution_name??'Connected brokerage'
    const total=a.balance?.total
    const native=nativeAccountRows({...a,currency:total?.currency?{code:total.currency}:undefined},rows,fills)
    for(const group of native.groups){
      const normalized=group.trades.map(trade=>({...trade,account:group.accountId,broker}))
      trades.push(...(matchFills(normalized) as Trade[]).filter(t=>new Date(t.date)>=displayStart))
      holdings.push(...group.holdings.map(holding=>({...holding,account:group.accountId,broker})))
      const first=group.trades.reduce((oldest,f)=>new Date(f.date)<oldest?new Date(f.date):oldest,new Date())
      accounts.push({id:group.accountId,broker,name:a.name??'Connected account',lastFour:a.number?.slice(-4)??'Account',currency:group.currency,coverage:Math.min(24,Math.max(0,Math.floor((Date.now()-first.getTime())/2629800000))),balance:group.holdings.reduce((sum,p)=>sum+p.quantity*p.price,0),...currentAccountValue(a,rows,cash.status==='fulfilled'?cash.value:[],group.currency,native.groups.length===1,pos.status==='fulfilled'),capital:normalizeCapital(native.groups.length===1&&history.status==='fulfilled'?history.value:null,fills,group.currency,activity.status==='fulfilled'&&activity.value.complete&&a.sync_status?.transactions?.initial_sync_completed===true),status:'connected',execution:false})
    }
    if(activity.status==='fulfilled'&&!activity.value.complete)warnings.push(broker+': transaction history exceeds the current import limit. Contribution analysis is unavailable.')
    if(pos.status==='rejected'||activity.status==='rejected')warnings.push(broker+': some account data is unavailable.')
    if(native.unknown)warnings.push(broker+': records with an unknown currency are excluded.')
   }))
  }catch{warnings.push('A brokerage connection needs attention. Reconnect it in Accounts.')}
 }
 const seen=new Set<string>()
 for(const c of connections??[]){
  const paper=c.paper_mode!==false
  if(seen.has(paper?'paper':'real'))continue
  seen.add(paper?'paper':'real')
  try{
   const client=createAlpacaClient({apiKey:decrypt(c.api_key_encrypted),apiSecret:decrypt(c.api_secret_encrypted),paper})
   const [info,positions,activity,orders]=await Promise.all([client.getAccount(),client.getPositions(),client.getActivities('FILL',from.toISOString()),client.getOrders('all')])
   const orderMap=new Map<string,Record<string,unknown>>((Array.isArray(orders)?orders:[]).map((o:Record<string,unknown>)=>[String(o.id),o]))
   const normalized=activity.map(f=>{const order=orderMap.get(f.order_id);const tag=String(order?.client_order_id??'');return {id:f.id,symbol:f.symbol,name:f.symbol,account:paper?'alpaca-paper':'alpaca-live',broker:'Alpaca',date:f.transaction_time,side:f.side==='buy'?'Buy' as const:'Sell' as const,quantity:Number(f.qty),price:Number(f.price),pnl:null,style:tag.includes('_DAY_')?'day' as const:tag.includes('_LT_')?'longterm' as const:'swing' as const,mode:paper?'paper' as const:'real' as const,status:'Filled' as const,origin:tag.startsWith('tickrtalk_')?'algo' as const:'manual' as const}})
   if(!paper){
    const duplicates=new Set(snapAccounts.filter(a=>/alpaca/i.test(a.institution_name)).map(a=>a.id))
    for(let i=holdings.length-1;i>=0;i--)if(duplicates.has(holdings[i].account))holdings.splice(i,1)
    for(let i=trades.length-1;i>=0;i--)if(duplicates.has(trades[i].account))trades.splice(i,1)
    for(let i=accounts.length-1;i>=0;i--)if(duplicates.has(accounts[i].id))accounts.splice(i,1)
    const first=activity.reduce((oldest,f)=>new Date(f.transaction_time)<oldest?new Date(f.transaction_time):oldest,new Date())
    const coverage=Math.min(24,Math.max(0,Math.floor((Date.now()-first.getTime())/2629800000)))
    accounts.push({id:'alpaca-live',broker:'Alpaca',name:'Execution account',lastFour:'Live',coverage,balance:positions.reduce((sum,p)=>sum+p.marketValue,0),accountValue:Number.isFinite(info.equity)?info.equity:null,status:'connected',execution:true})
    for(const p of positions)holdings.push({symbol:p.symbol,name:p.symbol,account:'alpaca-live',broker:'Alpaca',quantity:p.qty,cost:p.avgEntryPrice,price:p.currentPrice,color:'#b3c9d7',screening:'unavailable'})
   }
   trades.push(...(matchFills(normalized) as Trade[]).filter(t=>new Date(t.date)>=displayStart))
  }catch{warnings.push(`Alpaca ${paper?'paper':'real'} activity is unavailable. Check the connection.`)}
 }
 // Cached clients from the previous USD-only release must never receive rupee amounts as dollars.
 if(!nativeCurrencies){
  if(accounts.some(a=>(a.currency??'USD')!=='USD'))warnings.push('Reload the updated Journal to view non-USD accounts separately.')
  for(const rows of [holdings,accounts,trades])for(let index=rows.length-1;index>=0;index--)if((rows[index].currency??'USD')!=='USD')rows.splice(index,1)
 }
 return NextResponse.json({holdings,accounts,trades:trades.sort((a,b)=>new Date(b.date).getTime()-new Date(a.date).getTime()),warning:warnings.length?'Journal connections: '+warnings.join(' '):'',valueLabel:'Connected position value'})
}
