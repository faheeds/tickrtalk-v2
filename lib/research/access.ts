import { requireUser } from '@/lib/auth'
import { allowsLocalResearch } from './local-access.mjs'

export function isLocalResearch(req: Request) {
  return allowsLocalResearch(req, process.env.ENABLE_LOCAL_RESEARCH === 'true')
}
export async function researchUser(req: Request) {
  if (isLocalResearch(req)) return 'local_owner'
  return requireUser().catch(() => null)
}
