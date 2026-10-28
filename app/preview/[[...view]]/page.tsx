import WorkspaceApp from '@/app/components/workspace/workspace-app'
import type { View } from '@/lib/workspace/types'
import { notFound } from 'next/navigation'
const views = ['journal','research','algo','screening','accounts','plans','settings','help','owner']
export default async function PreviewPage({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view } = await params
  const selected = view?.[0] ?? 'journal'
  if (!views.includes(selected) || (view?.length ?? 0) > 1) notFound()
  const localServices=process.env.VERCEL!=='1'&&(process.env.ENABLE_LOCAL_PAPER==='true'||process.env.ENABLE_LOCAL_RESEARCH==='true')
  if(selected==='owner'&&!localServices)notFound()
  return <WorkspaceApp demo localServices={localServices} view={selected as View} />
}
