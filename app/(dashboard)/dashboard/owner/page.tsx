import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import WorkspaceApp from '@/app/components/workspace/workspace-app'
export default async function OwnerPage() {
 const {userId} = await auth()
 const allowed=(process.env.OWNER_USER_IDS ?? '').split(',').map(s=>s.trim()).filter(Boolean)
 if(!userId || !allowed.includes(userId)) notFound()
 return <WorkspaceApp view="owner" />
}
