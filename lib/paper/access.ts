import {auth} from '@clerk/nextjs/server'
import {allowsLocalResearch} from '@/lib/research/local-access.mjs'
export async function paperAccess(req:Request){
  if(allowsLocalResearch(req,process.env.ENABLE_LOCAL_PAPER==='true'))return {user:'local_owner',owner:true}
  const identity=await auth().catch(()=>null)
  if(!identity?.userId)return null
  return {user:identity.userId,owner:(process.env.OWNER_USER_IDS??'').split(',').map(id=>id.trim()).includes(identity.userId)}
}
