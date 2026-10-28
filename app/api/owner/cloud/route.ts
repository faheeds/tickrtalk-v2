import {NextResponse} from 'next/server'
import {paperAccess} from '@/lib/paper/access'
import {cloudDatabase} from '@/lib/deployment/database.mjs'
import {startCloudPaper} from '@/services/paper/schedule'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(req:Request){
 const access=await paperAccess(req);if(!access?.owner)return NextResponse.json({error:'Owner access required.'},{status:403})
 try{const db=cloudDatabase();const rows=await db('paper_cloud_state?id=eq.1&select=revision,generation,updated_at');return NextResponse.json({runtime:rows[0]??null,executionEnabled:process.env.CLOUD_PAPER_EXECUTION==='true'})}catch{return NextResponse.json({error:'Cloud database migration or configuration is missing.'},{status:503})}
}
export async function POST(req:Request){
 const access=await paperAccess(req);if(!access?.owner)return NextResponse.json({error:'Owner access required.'},{status:403})
 const input=await req.json().catch(()=>null);if(input?.action!=='start_monitoring')return NextResponse.json({error:'Unknown cloud operation.'},{status:400})
 if(process.env.VERCEL_ENV!=='production'||process.env.PAPER_RUNTIME!=='cloud')return NextResponse.json({error:'Cloud monitoring can start only in the production cloud runtime.'},{status:409})
 try{
  return NextResponse.json({...await startCloudPaper(),executionEnabled:process.env.CLOUD_PAPER_EXECUTION==='true'})
 }catch{return NextResponse.json({error:'Cloud monitoring could not start.'},{status:503})}
}
