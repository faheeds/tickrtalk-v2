import {NextResponse} from 'next/server'
import {paperAccess} from '@/lib/paper/access'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const ownerActions=new Set(['refresh_sp500','save_draft','validate_draft','publish','halt','unhalt','scan','dry_run','smoke','flatten'])
async function handle(req:Request){
  const access=await paperAccess(req)
  if(!access)return NextResponse.json({error:'Unauthorized'},{status:401})
  const endpoint=process.env.PAPER_API_URL,token=process.env.PAPER_SERVICE_TOKEN

  const input=req.method==='POST'?await req.json().catch(()=>null):null
  if(req.method==='POST'&&(!input||typeof input.action!=='string'))return NextResponse.json({error:'A paper action is required.'},{status:400})
  if(ownerActions.has(input?.action)&&!access.owner)return NextResponse.json({error:'Owner access required.'},{status:403})
  try{
    if(process.env.PAPER_RUNTIME==='cloud'){
      if(process.env.VERCEL_ENV!=='production')return NextResponse.json({error:'Paper cloud access is restricted to production.'},{status:503})
      const {cloudPaperAction}=await import('@/services/paper/cloud.mjs')
      const result=await cloudPaperAction(access.user,access.owner,req.method==='GET'?'status':input.action,input??{})
      if(['connect','authorize'].includes(input?.action)){const {startCloudPaper}=await import('@/services/paper/schedule');await startCloudPaper()}
      return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}})
    }
    if(!endpoint||!token)return NextResponse.json({error:'Paper execution service is not configured.'},{status:503})
    const url=new URL(endpoint)
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Invalid paper service URL')
    url.pathname=url.pathname.replace(/\/$/,'')+'/api'
    const response=await fetch(url,{method:req.method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Paper-User':access.user,'X-Paper-Role':access.owner?'owner':'customer'},body:input?JSON.stringify(input):undefined,cache:'no-store',signal:AbortSignal.timeout(50000)})
    return NextResponse.json(await response.json(),{status:response.status,headers:{'Cache-Control':'no-store'}})
  }catch(error){const status=error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'?error.status:503;return NextResponse.json({error:status===422&&error instanceof Error?error.message:status===409?'Paper monitoring is reconciling or awaiting cloud cutover. Please retry shortly.':'The paper service is unavailable. Check its worker and connection status.'},{status})}
}
export const GET=handle
export const POST=handle
