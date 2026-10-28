'use client'
import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRight, ArrowUpRight, BookmarkSimple, Clock, DownloadSimple, Sparkle, X } from '@phosphor-icons/react'
import type { ResearchHealth, ResearchJob } from '@/lib/research/types'
import type { WorkspaceProps } from './workspace-app'
import { BrandAvatar, Button, EmptyState, Notice, PageHeader, StatusBadge } from './primitives'

const sectionOrder = ['overview', 'fundamentals', 'technical', 'news', 'sentiment', 'debate', 'tradePlan', 'risk', 'decision', 'sources']
const labels: Record<string, string> = {overview: 'Overview', fundamentals: 'Fundamentals', technical: 'Technical analysis', news: 'News & macro', sentiment: 'Sentiment', debate: 'Bull & bear', tradePlan: 'Proposed plan', risk: 'Risk perspectives', decision: 'Final review', sources: 'Sources & context'}
const active = (job: ResearchJob | null) => !!job && ['queued', 'running'].includes(job.status)
const date = (value: string) => new Date(value).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})
function safeURL(url: string) { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? url : undefined } catch { return undefined } }

export function TradingAgentsResearch({demo, screens, showScreen, toast}: WorkspaceProps) {
  const [symbol, setSymbol] = useState('AAPL')
  const [query, setQuery] = useState('')
  const [health, setHealth] = useState<ResearchHealth | null>(null)
  const [jobs, setJobs] = useState<ResearchJob[]>([])
  const [job, setJob] = useState<ResearchJob | null>(null)
  const [section, setSection] = useState('overview')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)
  const [historyFilter, setHistoryFilter] = useState('all')
  const trackedId = jobs.find(item => active(item))?.id ?? (active(job) ? job!.id : undefined)

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/research', {signal, cache: 'no-store'})
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Research is unavailable.')
    setHealth(data.health); setJobs(data.jobs)
    return data.jobs as ResearchJob[]
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    loadHistory(controller.signal).then(history => {
      const pending = history.find(item => active(item))
      if (pending) { setJob(pending); setSymbol(pending.symbol) }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setChecking(false) })
    return () => controller.abort()
  }, [loadHistory])

  useEffect(() => {
    if (!trackedId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const response = await fetch(`/api/research?job=${trackedId}`, {signal: controller.signal, cache: 'no-store'})
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Unable to check analysis progress.')
        if (controller.signal.aborted) return
        setJob(current => current?.id === trackedId ? data.job : current)
        setJobs(current => current.map(item => item.id === trackedId ? data.job : item))
        if (!active(data.job)) { await loadHistory(controller.signal); return }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to check analysis progress.') }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 300)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [trackedId, loadHistory])

  async function refresh() {
    setChecking(true); setError('')
    try { await loadHistory() } catch (e) { setError(e instanceof Error ? e.message : 'Unable to check the connection.') }
    finally { setChecking(false) }
  }
  async function generate() {
    if (trackedId || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/research', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({symbol})})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Unable to start research.')
      setJob(data.job); setSection('overview'); await loadHistory()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to start research.') }
    finally { setBusy(false) }
  }
  async function open(item: ResearchJob) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/research?job=${item.id}`, {cache: 'no-store'})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setJob(data.job); setSymbol(data.job.symbol); setSection('overview')
    } catch (e) { setError(e instanceof Error ? e.message : 'Report unavailable.') }
    finally { setBusy(false) }
  }
  async function change(method: 'DELETE' | 'PATCH') {
    if (!job) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/research?job=${job.id}`, {method, headers: {'Content-Type': 'application/json'}, body: method === 'PATCH' ? JSON.stringify({saved: !job.saved}) : undefined})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      setJob(data.job); await loadHistory(); toast(method === 'DELETE' ? data.job.status === 'cancelled' ? 'Analysis cancelled.' : 'This analysis has already finished.' : data.job.saved ? 'Report saved.' : 'Report removed from saved research.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update research.') }
    finally { setBusy(false) }
  }
  function search(e: React.FormEvent) {
    e.preventDefault()
    const ticker = query.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9.-]{0,19}$/.test(ticker)) { setError('Enter a valid stock symbol, such as AAPL or BRK-B.'); return }
    if (trackedId) { setError('Let your current analysis finish, or cancel it before researching another stock.'); return }
    setSymbol(ticker); setQuery(''); setJob(null); setError(''); setSection('overview')
  }
  const report = job?.report
  function download() {
    if (!report) return
    const text = `# ${report.symbol} research\n\nAnalysis date: ${report.analysisDate}\nGenerated: ${report.generatedAt}\nEngine: TradingAgents\nRepository commit: ${report.provenance.commit}\n\n` + sectionOrder.filter(key => key !== 'sources').map(key => `## ${report.sections[key]?.title ?? labels[key]}\n\n${report.sections[key]?.content || 'Not supplied by the agents.'}`).join('\n\n') + '\n\n## Source links\n\n' + report.sources.map(source => `${source.section}: ${source.url}`).join('\n') + '\n\n## Qualifications\n\n' + report.warnings.join('\n\n')
    const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown;charset=utf-8'}))
    const link = document.createElement('a'); link.href = url; link.download = `${report.symbol}-research-${report.analysisDate}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <>
    <PageHeader title="Research with perspective." description="Four analyst perspectives. Both sides of the case. A considered risk review." action={<span className="methodology-tag"><Sparkle size={17} /> Powered by TradingAgents</span>} />
    <form className="research-search" onSubmit={search}><label className="search-control"><span aria-hidden="true">⌕</span><input aria-label="Stock symbol for TradingAgents" type="search" placeholder="Enter a stock symbol" value={query} onChange={e => setQuery(e.target.value)} /></label><Button type="submit" secondary disabled={!query.trim() || !!trackedId}>Select stock <ArrowRight size={16} /></Button></form>
    {error ? <Notice warning>{error}</Notice> : null}
    {!health?.ready ? <section className="research-connection"><div><strong>{checking ? 'Checking the research connection…' : health ? 'TradingAgents is connected. Analysis needs configuration.' : 'Connect the research engine.'}</strong><p>{demo ? 'This view uses the actual research service. Sample reports are available separately in Sample walkthrough.' : 'Research will be available once the service is ready.'}</p>{demo && health?.missing.length ? <details><summary>Local service setup</summary><ul>{health.missing.map(item => <li key={item}>{item}</li>)}</ul><p>Add the missing settings to the private .env.research file, then restart the research service.</p></details> : null}</div><Button secondary onClick={refresh} disabled={checking}>Check connection</Button></section> : <p className="research-engine-status"><span className="status-dot" />TradingAgents connected · {health.provider} · Research only</p>}
    <section className="research-company-header"><div className="company-identity"><BrandAvatar symbol={symbol} large /><div><div className="symbol-line"><h2>{symbol}</h2><StatusBadge status={demo ? 'unavailable' : screens[symbol]?.status ?? 'unavailable'} onClick={demo ? undefined : () => showScreen(symbol)} /></div><p>{job ? `Analysis date · ${job.analysisDate}` : 'New analysis uses the current UTC date'}</p></div></div><div className="company-actions">{report ? <><Button secondary onClick={() => change('PATCH')} disabled={busy}><BookmarkSimple size={17} weight={job?.saved ? 'fill' : 'regular'} />{job?.saved ? 'Saved' : 'Save report'}</Button><Button secondary onClick={download}><DownloadSimple size={17} />Export</Button></> : null}<Button onClick={generate} disabled={busy || checking || !health?.ready || !!trackedId}><Sparkle size={17} />{busy ? 'Please wait…' : trackedId ? 'Analysis in progress' : report ? 'Run fresh analysis' : 'Run analysis'}</Button></div></section>
    {active(job) ? <div className="research-progress" role="status"><span className="loading-orbit"><Sparkle size={24} /></span><h2>The analyst team is working.</h2><p>{job?.stage}</p><p className="small-text">This can take several minutes. You can leave and reopen this job from your history.</p><Button secondary onClick={() => change('DELETE')} disabled={busy}><X size={16} />Cancel analysis</Button></div> : job && ['failed', 'cancelled'].includes(job.status) ? <Notice warning>{job.error ?? 'This analysis was cancelled. Start a new analysis when you are ready.'}</Notice> : null}
    {report && (!report.sources.length || !!report.coverageWarnings?.length) ? <Notice warning><strong>Evidence coverage needs attention.</strong><p>{!report.sources.length ? 'The agents supplied no source links. ' : ''}{report.coverageWarnings?.length ? 'Some optional data feeds were unavailable. ' : ''}<button className="text-link" onClick={() => setSection('sources')}>Review sources & context <ArrowRight size={14} /></button></p></Notice> : null}
    {report ? <div className="research-layout"><nav className="research-section-nav" aria-label="TradingAgents report sections">{sectionOrder.map(key => <button key={key} onClick={() => setSection(key)} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined}>{labels[key]}</button>)}<div className="report-age"><Clock size={14} /><span>Generated<br />{date(report.generatedAt)}</span></div></nav><article className="research-report"><div className="section-heading"><h2>{section === 'sources' ? 'Sources and qualifications' : report.sections[section]?.title ?? labels[section]}</h2><span className="small-text">Original agent report</span></div>{section === 'sources' ? <><Notice warning>Links below appeared in the agent reports. They are not independently verified citations.</Notice><div className="source-list">{report.sources.length ? report.sources.map((source, i) => <div key={`${source.url}-${i}`}><strong>{labels[source.section] ?? source.section}</strong>{safeURL(source.url) ? <a href={safeURL(source.url)} target="_blank" rel="noopener noreferrer">{source.url}<ArrowUpRight size={14} /></a> : <span>Unsupported source link</span>}</div>) : <p>No source URLs were supplied by the agents.</p>}</div><ul className="research-qualifications">{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul><details className="research-provenance"><summary>Report provenance</summary><p>Repository: <a href={safeURL(report.provenance.repository)} target="_blank" rel="noopener noreferrer">TradingAgents_TauricResearch</a></p><p>Commit: <code>{report.provenance.commit}</code>{report.provenance.workingTreeModified ? ' · modified working tree' : ''}</p><p>Models: {report.provenance.deepModel} / {report.provenance.quickModel}</p><p>Generated: {report.generatedAt}</p><p>Requested analysis cutoff: {report.analysisDate}</p></details></> : report.sections[section]?.content ? <div className="agent-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{a: ({href, children}) => safeURL(href ?? '') ? <a href={safeURL(href!)} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>, table: ({children}) => <div className="agent-table-scroll"><table>{children}</table></div>}}>{report.sections[section].content}</ReactMarkdown></div> : <Notice>This section was not supplied by the agents. No replacement analysis has been generated.</Notice>}<div className="research-callout"><strong>Research is separate from execution.</strong><p>Proposed trades and risk conclusions in this report do not place orders.</p></div></article></div> : !active(job) ? <EmptyState title="Bring the analyst team to your next decision." description="TradingAgents examines fundamentals, technical signals, news, and sentiment, then compares the bull and bear cases and reviews risk." /> : null}
    <section className="research-history"><div className="section-heading"><h2>Your research history</h2><div className="research-history-filters" role="group" aria-label="Research history filter"><button aria-pressed={historyFilter === 'all'} onClick={() => setHistoryFilter('all')}>All reports</button><button aria-pressed={historyFilter === 'saved'} onClick={() => setHistoryFilter('saved')}>Saved</button></div></div>{jobs.filter(item => historyFilter !== 'saved' || item.saved).length ? <div className="research-job-list">{jobs.filter(item => historyFilter !== 'saved' || item.saved).map(item => <button key={item.id} onClick={() => open(item)} disabled={busy} className={job?.id === item.id ? 'selected' : ''}><strong>{item.symbol}{item.saved ? <BookmarkSimple size={13} weight="fill" /> : null}</strong><span>{date(item.createdAt)}</span><span className={`job-status ${item.status}`}>{item.status}</span><ArrowRight size={16} /></button>)}</div> : <p className="small-text">{historyFilter === 'saved' ? 'Saved reports will appear here.' : 'Your actual analysis jobs will appear here. History persists in the research service.'}</p>}</section>
    <p className="table-footnote">AI-generated research can be incomplete or incorrect. Review its evidence and assumptions before making an investment decision.</p>
  </>
}
