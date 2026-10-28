import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import WorkspaceApp from '@/app/components/workspace/workspace-app'

export default async function OwnerBacktestsPage() {
  const { userId } = await auth()
  const allowed = (process.env.OWNER_USER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean)
  if (!userId || !allowed.includes(userId)) notFound()
  return <WorkspaceApp view="ownerBacktests" />
}
