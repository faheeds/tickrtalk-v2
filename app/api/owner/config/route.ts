import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
async function owner() {
 const {userId}=await auth()
 const allowed=(process.env.OWNER_USER_IDS??'').split(',').map(s=>s.trim()).filter(Boolean)
 return userId&&allowed.includes(userId)?userId:null
}
export async function GET() {
 if(!await owner()) return NextResponse.json({error:'Owner access required.'},{status:403})
 const {data,error}=await supabaseAdmin.from('owner_config_drafts').select('config,updated_at').eq('id','strategy').maybeSingle()
 return error?NextResponse.json({error:'Owner draft storage is not configured.'},{status:503}):NextResponse.json(data??{})
}
export async function PUT(req:Request) {
 const userId=await owner(); if(!userId) return NextResponse.json({error:'Owner access required.'},{status:403})
 const input=await req.json().catch(()=>null)
 const exposure=Number(input?.maxExposure),loss=Number(input?.dailyLoss)
 if(!input||!Number.isFinite(exposure)||exposure<=0||exposure>100||!Number.isFinite(loss)||loss<=0||loss>20||!['Market hours','End of day','Owner scheduled'].includes(input.schedule)||typeof input.screening!=='boolean') return NextResponse.json({error:'Invalid draft limits.'},{status:400})
 const config={maxExposure:exposure,dailyLoss:loss,schedule:input.schedule,screening:input.screening}
 const {error}=await supabaseAdmin.from('owner_config_drafts').upsert({id:'strategy',config,updated_by:userId,updated_at:new Date().toISOString()})
 return error?NextResponse.json({error:'Owner draft storage is not configured.'},{status:503}):NextResponse.json({saved:true,state:'draft'})
}
