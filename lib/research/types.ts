export type ResearchReport = {
  symbol: string; analysisDate: string; generatedAt: string; engine: string
  provenance: {repository: string; commit: string; workingTreeModified: boolean; provider: string; deepModel: string; quickModel: string}
  sections: Record<string, {title: string; content: string}>
  sources: {url: string; section: string}[]; warnings: string[]; coverageWarnings?: string[]
}
export type ResearchJob = {
  id: string; symbol: string; analysisDate: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: string; createdAt: string; updatedAt: string; error: string | null; saved: boolean; report?: ResearchReport | null
}
export type ResearchHealth = {ready: boolean; missing: string[]; engine: string; provider?: string; deepModel?: string; quickModel?: string}
