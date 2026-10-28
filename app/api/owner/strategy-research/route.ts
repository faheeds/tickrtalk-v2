import {auth} from '@clerk/nextjs/server'
import {NextResponse} from 'next/server'
import snapshot from '@/lib/strategies/research-summary.json'
import {canReadOwnerResearch} from '@/lib/research/owner-access.mjs'
export const dynamic='force-dynamic'
export async function GET(){
 const identity=await auth().catch(()=>null)
 if(!identity?.userId)return NextResponse.json({error:'Sign in to view owner research.'},{status:401,headers:{'Cache-Control':'private, no-store'}})
 if(!canReadOwnerResearch(identity.userId,process.env.OWNER_USER_IDS))return NextResponse.json({error:'Owner access required.'},{status:403,headers:{'Cache-Control':'private, no-store'}})
 return NextResponse.json(snapshot,{headers:{'Cache-Control':'private, no-store'}})
}
