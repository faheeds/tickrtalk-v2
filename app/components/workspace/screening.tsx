'use client'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, ArrowsClockwise, CheckCircle, Info, MagnifyingGlass, Scales, Warning, XCircle } from '@phosphor-icons/react'
import { sampleScreen } from '@/lib/workspace/sample-data'
import { chunkSymbols, screeningCounts } from '@/lib/workspace/finance.mjs'
import type { Screening, ScreenStatus } from '@/lib/workspace/types'
import type { WorkspaceProps } from './workspace-app'
import { BrandAvatar, Button, EmptyState, money, Notice, PageHeader, StatusBadge } from './primitives'

export function ScreeningView(props: WorkspaceProps) {
  const { demo, holdings, accounts, screens, setScreens, showScreen, navigate } = props
  const [tab, setTab] = useState('portfolio')
  const [account, setAccount] = useState('all')
  const [filter, setFilter] = useState('all')
  const [input, setInput] = useState('')
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const portfolio = holdings.filter(h => account === 'all' || h.account === account)
  const counts = screeningCounts(portfolio, screens)
  const filtered = portfolio.filter(h => filter === 'all' || (screens[h.symbol]?.status ?? 'unavailable') === filter)
  async function screenPortfolio() {
    setBusy(true); setProgress(0); setError('')
    const chunks = chunkSymbols(portfolio.map(h => h.symbol))
    try {
      for (const symbols of chunks) {
        let results: Screening[]
        if (demo) { await new Promise(r => setTimeout(r, 450)); results = symbols.map(s => sampleScreen(s)).filter(Boolean) as Screening[] }
        else { const response = await fetch('/api/screening', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Screening could not be completed.'); results = data.results; if (data.errors?.length) setError('Some stocks could not be screened. Successful results are shown below.') }
        setScreens(Object.fromEntries(results.map(r => [r.ticker, r]))); setProgress(p => p + symbols.length)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Screening is temporarily unavailable. Please try again.') }
    finally { setBusy(false) }
  }
  function lookup(e: React.FormEvent) { e.preventDefault(); if (!input.trim()) return; setSelectedSymbol(input.trim().toUpperCase()) }
  return <>
    <PageHeader title="Know what you hold." description="AAOIFI screening for a clearer, values-aligned portfolio." action={<div className="methodology-tag"><Scales size={17} /> AAOIFI methodology <Info size={14} /></div>} />
    <div className="tabs-row screening-tabs"><div className="text-tabs" role="tablist" aria-label="Screening mode"><button role="tab" aria-selected={tab === 'portfolio'} className={tab === 'portfolio' ? 'active' : ''} onClick={() => setTab('portfolio')}>My portfolio</button><button role="tab" aria-selected={tab === 'lookup'} className={tab === 'lookup' ? 'active' : ''} onClick={() => setTab('lookup')}>Check a stock</button></div><button className="text-link" onClick={() => navigate('help')}>How screening works <ArrowUpRight size={14} /></button></div>
    {tab === 'portfolio' ? <>
      <div className="screening-toolbar"><label className="select-control"><select aria-label="Filter screening by account" value={account} onChange={e => setAccount(e.target.value)}><option value="all">All accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.broker} ••{a.lastFour}</option>)}</select></label><div className="screening-update"><span>{busy ? `${progress} stocks checked` : demo ? 'Illustrative statuses · Oct 13, 2026' : Object.keys(screens).length ? 'Saved to your account · view reports for dates' : 'Not yet screened'}</span><Button onClick={screenPortfolio} disabled={busy || !portfolio.length}><ArrowsClockwise size={17} className={busy ? 'spinning' : ''} /> {busy ? 'Screening your portfolio…' : 'Screen my portfolio'}</Button></div></div>
      {error ? <Notice warning>{error}</Notice> : null}
      <div className="screening-summary"><div><strong>{portfolio.length}</strong><span>stocks in your portfolio</span></div>{(['pass', 'review', 'fail', 'unavailable'] as const).map(status => <button key={status} className={`count-button ${status} ${filter === status ? 'selected' : ''}`} onClick={() => setFilter(filter === status ? 'all' : status)} aria-pressed={filter === status}><strong>{counts[status]}</strong><StatusBadge status={status} /></button>)}</div>
      <div className="section-heading"><div><h2>Portfolio screening results</h2><p>A little clarity, next to every stock.</p></div>{filter !== 'all' ? <button className="text-link" onClick={() => setFilter('all')}>Show all stocks</button> : <span className="small-text">{portfolio.length - counts.unavailable} of {portfolio.length} assessed</span>}</div>
      <div className="table-wrap"><table className="ws-table screening-table"><thead><tr><th>Stock & screening status</th><th>Account</th><th className="numeric">Shares</th><th className="numeric">Current value</th><th>Assessment</th><th aria-label="Report" /></tr></thead><tbody>{filtered.map(h => { const report = screens[h.symbol]; return <tr key={`${h.symbol}-${h.account}`}><td><div className="stock-cell"><BrandAvatar symbol={h.symbol} /><div><div className="symbol-line"><strong>{h.symbol}</strong><StatusBadge status={report?.status ?? 'unavailable'} onClick={() => showScreen(h.symbol)} /></div><span>{h.name}</span></div></div></td><td>{h.broker}<span className="cell-subtext">••{accounts.find(a => a.id === h.account)?.lastFour ?? 'Account'}</span></td><td className="numeric">{h.quantity}</td><td className="numeric">{money(h.quantity * h.price,false,h.currency??'USD')}</td><td><span>{report?.verdict ?? 'Not screened'}</span>{report?.qualification ? <span className="cell-subtext caution">Verification incomplete</span> : report?.status === 'unavailable' ? <span className="cell-subtext">Company screening only</span> : null}</td><td><button className="text-link" aria-label={`View ${h.symbol} screening report`} onClick={() => showScreen(h.symbol)}>View report <ArrowUpRight size={14} /></button></td></tr> })}</tbody></table></div>
      {!filtered.length ? <EmptyState title={portfolio.length ? 'No stocks in this category' : 'Bring your portfolio into view'} description={portfolio.length ? 'Try another status or account filter.' : 'Connect a supported brokerage account, or check a stock individually.'} action={<Button onClick={() => portfolio.length ? setFilter('all') : navigate('accounts')}>{portfolio.length ? 'Show all stocks' : 'Connect an account'}</Button>} /> : null}
      <div className="screening-bottom-note"><Info size={20} /><div><strong>Clarity comes with context.</strong><p>These are screening assessments, not certification. Review the evidence and any missing checks. Funds and ETFs are not screened directly by this service.</p></div><button className="text-link" onClick={() => navigate('help')}>Learn more <ArrowUpRight size={14} /></button></div>
    </> : <><form className="stock-search-form" onSubmit={lookup}><label className="search-control"><MagnifyingGlass size={20} /><input aria-label="Stock symbol" placeholder="Enter a stock symbol, e.g. AAPL" autoComplete="off" value={input} onChange={e => setInput(e.target.value)} /></label><Button type="submit" disabled={!input.trim()}>Check stock <ArrowRight size={17} /></Button></form>{demo ? <p className="small-text">Sample results are available for AAPL, MSFT, JPM, NVDA, and VOO.</p> : null}{selectedSymbol ? <ScreeningReport key={selectedSymbol} symbol={selectedSymbol} {...props} /> : <div className="lookup-intro"><Scales size={46} weight="light" /><h2>More than a label.</h2><p>Look up a company to see its business activity assessment, financial checks, and the evidence behind its status.</p><div className="lookup-checks"><span><CheckCircle size={17} /> Business activities</span><span><CheckCircle size={17} /> Financial ratios</span><span><CheckCircle size={17} /> Data qualifications</span></div></div>}</>}
  </>
}

export function ScreeningReport({ symbol, demo, screens, setScreens }: WorkspaceProps & { symbol: string }) {
  const [result, setResult] = useState<Screening | null>(screens[symbol] ?? null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(!screens[symbol])
  useEffect(() => {
    if (screens[symbol]) { setResult(screens[symbol]); setLoading(false); return }
    if (demo) { const r = sampleScreen(symbol); setResult(r); setLoading(false); if (!r) setError('This symbol is not included in the sample workspace. Try AAPL, MSFT, JPM, NVDA, or VOO.'); return }
    const controller = new AbortController()
    setLoading(true); setError('')
    fetch(`/api/screening?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal }).then(async r => { const body = await r.json(); if (!r.ok) throw new Error(body.error ?? 'Screening is unavailable.'); setResult(body); setScreens({ [symbol]: body }) }).catch(e => { if (e.name !== 'AbortError') setError(e.message) }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [symbol, demo, screens, setScreens])
  if (loading) return <div className="report-loading" role="status"><ArrowsClockwise className="spinning" size={24} /><h3>Checking {symbol}</h3><p>Reviewing the available company data.</p></div>
  if (error || !result) return <EmptyState title="Screening unavailable" description={error || 'No screening result is available for this stock.'} />
  return <article className="screening-report"><div className="report-company"><div><div className="eyebrow">STOCK SCREENING</div><h2>{symbol}</h2></div><StatusBadge status={result.status} large /></div><div className="report-verdict"><span>Engine verdict</span><strong>{result.verdict}</strong><p>{result.reason}</p></div>{result.qualification ? <Notice warning><strong>Verification incomplete</strong><p>{result.qualification} Review the missing check before relying on this result.</p></Notice> : null}{result.ratios.length ? <><h3 className="report-section-title">The financial checks</h3><div className="table-wrap"><table className="ws-table ratio-table"><thead><tr><th>Check</th><th>Result</th><th>Service limit</th><th>Status</th></tr></thead><tbody>{result.ratios.map(r => <tr key={r.key}><td>{r.label}</td><td className="numeric">{r.value == null ? 'Unavailable' : `${(r.value * 100).toFixed(1)}%`}</td><td>Below {(r.threshold * 100).toFixed(0)}%</td><td><span className={`check-state ${r.status === 'pass' ? 'gain' : r.status === 'fail' ? 'loss' : 'caution'}`}>{r.status === 'pass' ? <CheckCircle size={16} weight="fill" /> : r.status === 'fail' ? <XCircle size={16} /> : <Warning size={16} />}{r.status === 'pass' ? 'Pass' : r.status === 'fail' ? 'Fail' : 'Review needed'}</span></td></tr>)}</tbody></table></div></> : null}<div className="report-provenance"><div><span>Screened</span><strong>{new Date(result.asOf).toLocaleDateString('en-US', { dateStyle: 'medium' })}</strong></div><div><span>Financial period</span><strong>{result.period ?? 'Not supplied'}</strong></div><div><span>Result source</span><strong>{demo ? 'Illustrative assessment' : result.source ?? 'AAOIFI screening service'}</strong></div></div>{result.sourceUrl?.startsWith('https://') ? <a className="text-link" href={result.sourceUrl} target="_blank" rel="noreferrer">View source filing <ArrowUpRight size={14} /></a> : null}<p className="methodology-copy">Screening result under the app’s AAOIFI methodology. This is decision support, not a scholarly ruling. {demo ? 'All statuses and ratio values in this workspace are illustrative.' : ''}</p></article>
}
