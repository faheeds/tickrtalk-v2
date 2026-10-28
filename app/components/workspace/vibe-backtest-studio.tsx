'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FloppyDisk, Play, ShieldCheck } from '@phosphor-icons/react'
import type { WorkspaceProps } from './workspace-app'
import { Button, Notice, PageHeader } from './primitives'
import { annualizedReturnDecimal, interpretBacktest } from '@/lib/backtests/interpretation.mjs'

type Job = { id: string; status: string; stage: string; createdAt: string; request?: Record<string, unknown>; error?: string | null; result?: Result }
type Result = { metrics?: Record<string, unknown>; validation?: Record<string, unknown>; warnings?: unknown[]; coverage?: { requested?: string[]; included?: string[]; excluded?: string[] }; equity?: Record<string, string>[]; trades?: Record<string, string>[]; request?: Record<string, unknown>; feed?: string; engine?: string; version?: string }
const today = new Date().toISOString().slice(0, 10)
const twoYearsAgo = new Date(Date.now() - 2 * 365.25 * 86400000).toISOString().slice(0, 10)
const strategyDetails: Record<string, { name: string; description: string; fastLabel: string; slowLabel: string }> = {
  moving_average_trend: { name: 'Moving average trend', description: 'Holds stocks while the short average is above the long average.', fastLabel: 'Short average', slowLabel: 'Long average' },
  momentum_confirmation: { name: 'Momentum confirmation', description: 'Holds stocks only while returns are positive across both selected lookback windows.', fastLabel: 'Short momentum window', slowLabel: 'Long momentum window' },
  bollinger_pullback: { name: 'Bollinger pullback', description: 'Looks for a pullback below the lower band while price remains above its longer trend average, then exits at the band midpoint.', fastLabel: 'Band period', slowLabel: 'Trend filter period' },
  donchian_breakout: { name: 'Donchian breakout', description: 'Enters after a close above the longer price channel and exits below the shorter channel.', fastLabel: 'Exit channel', slowLabel: 'Entry channel' },
}

function reportStrategyDetails(result: Result) {
  const request = result.request ?? {}
  const fastWindow = Number(request.fastWindow)
  const slowWindow = Number(request.slowWindow)
  const fast = Number.isFinite(fastWindow) ? `${fastWindow}-session` : 'short-window'
  const slow = Number.isFinite(slowWindow) ? `${slowWindow}-session` : 'long-window'
  const strategyName = String(request.strategyName ?? 'Strategy details unavailable')
  const included = result.coverage?.included?.length
  const requested = result.coverage?.requested?.length
  const stockCount = Number.isFinite(included)
    ? Number.isFinite(requested) ? `${included} of ${requested} requested` : `${included}`
    : 'Not recorded'

  switch (strategyName) {
    case 'Moving average trend':
      return {
        strategyName,
        entry: `Enter or hold while the ${fast} moving average is above the ${slow} moving average.`,
        exit: 'Exit when the short moving average closes at or below the long moving average.',
        parameters: `${fast} short average · ${slow} long average`,
        stockCount,
      }
    case 'Momentum confirmation':
      return {
        strategyName,
        entry: `Enter or hold when returns are positive across both the ${fast} and ${slow} lookback windows.`,
        exit: 'Exit when either lookback return is zero or negative.',
        parameters: `${fast} short momentum · ${slow} long momentum`,
        stockCount,
      }
    case 'Bollinger pullback':
      return {
        strategyName,
        entry: `Enter when price closes below the lower band, set two standard deviations below its ${fast} center line, while remaining above the ${slow} trend average.`,
        exit: 'Exit when price reaches or rises above the band midpoint.',
        parameters: `${fast} band period · ${slow} trend filter`,
        stockCount,
      }
    case 'Donchian breakout':
      return {
        strategyName,
        entry: `Enter when price closes above the highest high of the prior ${slow} sessions.`,
        exit: `Exit when price closes below the lowest low of the prior ${fast} sessions.`,
        parameters: `${slow} entry channel · ${fast} exit channel`,
        stockCount,
      }
    default:
      return {
        strategyName,
        entry: 'Entry conditions were not recorded for this strategy.',
        exit: 'Exit conditions were not recorded for this strategy.',
        parameters: 'Not recorded',
        stockCount,
      }
  }
}

export function VibeBacktestStudio({ navigate }: WorkspaceProps) {
  const [form, setForm] = useState({ strategy: 'moving_average_trend', initialCapital: '1000', fastWindow: '20', slowWindow: '50', feed: 'iex', universe: 'custom', symbols: 'AAPL, MSFT, NVDA, AMZN, META', startDate: twoYearsAgo, endDate: today })
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [health, setHealth] = useState<{ ready?: boolean; missing?: string[]; engine?: string; version?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [detailLoadingId, setDetailLoadingId] = useState('')
  const [error, setError] = useState('')
  const requestedDetails = useRef(new Set<string>())

  const load = useCallback(async (id?: string) => {
    const response = await fetch(`/api/owner/backtests${id ? `?job=${encodeURIComponent(id)}` : ''}`, { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error ?? 'Backtest information could not be loaded.')
    if (id) setJobs(current => current.map(job => job.id === id ? body.job : job))
    else { setHealth(body.health); setJobs(body.jobs ?? []) }
  }, [])

  useEffect(() => { load().catch(e => setError(e.message)) }, [load])
  const activeId = selectedId || jobs.find(job => ['queued', 'running'].includes(job.status))?.id
  useEffect(() => {
    if (!activeId) return
    const timer = window.setInterval(() => load(activeId).catch(e => setError(e.message)), 5000)
    return () => window.clearInterval(timer)
  }, [activeId, load])

  const selected = jobs.find(job => job.id === selectedId) ?? jobs.find(job => ['queued', 'running'].includes(job.status)) ?? jobs[0]
  const result = selected?.result
  const interpretation = result ? interpretBacktest(result) : null
  const strategyReport = result ? reportStrategyDetails(result) : null
  const metrics = result?.metrics ?? {}
  const equity = result?.equity ?? []
  const selectedStrategy = strategyDetails[form.strategy] ?? strategyDetails.moving_average_trend
  const chart = useMemo(() => {
    const points = equity.map(row => Number(row.equity ?? row.portfolio_value ?? row.value)).filter(Number.isFinite)
    if (points.length < 2) return ''
    const min = Math.min(...points), max = Math.max(...points), range = max - min || 1
    return points.map((value, index) => `${(index / (points.length - 1)) * 100},${94 - ((value - min) / range) * 88}`).join(' ')
  }, [equity])

  useEffect(() => {
    if (!selected || selected.status !== 'completed' || selected.result || requestedDetails.current.has(selected.id)) return
    requestedDetails.current.add(selected.id)
    setDetailLoadingId(selected.id)
    load(selected.id)
      .catch(e => setError(e instanceof Error ? e.message : 'This report could not be loaded.'))
      .finally(() => setDetailLoadingId(current => current === selected.id ? '' : current))
  }, [selected?.id, selected?.status, selected?.result, load])

  async function run(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch('/api/owner/backtests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, initialCapital: Number(form.initialCapital), fastWindow: Number(form.fastWindow), slowWindow: Number(form.slowWindow) }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Backtest could not be started.')
      setJobs(current => [body.job, ...current]); setSelectedId(body.job.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Backtest could not be started.') }
    finally { setBusy(false) }
  }

  function update(key: keyof typeof form, value: string) { setForm(current => ({ ...current, [key]: value })) }
  const pretty = (value: unknown, percent = false) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return '—'
    return percent ? `${(number * (Math.abs(number) <= 1 ? 100 : 1)).toFixed(2)}%` : number.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }

  return <>
    <PageHeader eyebrow="OWNER RESEARCH LAB" title="Test the idea before it reaches paper." description="Run a historical, cash-only stock backtest with explicit data coverage and robustness checks." action={<Button secondary onClick={() => navigate('owner')}><ArrowLeft size={16} /> Owner console</Button>} />
        <Notice><strong>Research only. No orders are placed.</strong><p>This studio uses split and dividend adjusted daily bars, long-only stock positions, and 1× exposure. Broker commissions are excluded, share sizing may be fractional, and a current S&amp;P 500 list can introduce survivorship bias.</p></Notice>
    {error ? <Notice warning>{error}</Notice> : null}
    {health?.ready === false ? <Notice warning>Cloud backtesting needs secure Supabase storage and the existing credential-encryption setting configured before it can run.</Notice> : null}
    <div className="backtest-layout">
      <form className="backtest-form" onSubmit={run}>
        <div className="backtest-title"><div><span>SETUP</span><h2>Choose a test</h2></div><span className="environment-tag paper">Owner only</span></div>
        <label>Strategy<select value={form.strategy} onChange={e => update('strategy', e.target.value)}><option value="moving_average_trend">Moving average trend</option><option value="momentum_confirmation">Momentum confirmation</option><option value="bollinger_pullback">Bollinger pullback</option><option value="donchian_breakout">Donchian breakout</option></select><span className="small-text">{selectedStrategy.description}</span></label>
        <div className="backtest-fields two"><label>Starting cash<input type="number" min="100" max="10000000" step="100" value={form.initialCapital} onChange={e => update('initialCapital', e.target.value)} /></label><label>Market data<select value={form.feed} onChange={e => update('feed', e.target.value)}><option value="iex">IEX feed</option><option value="sip">SIP feed</option></select></label></div>
        <div className="backtest-fields two"><label>{selectedStrategy.fastLabel}<input type="number" min="5" max="100" value={form.fastWindow} onChange={e => update('fastWindow', e.target.value)} /></label><label>{selectedStrategy.slowLabel}<input type="number" min="20" max="250" value={form.slowWindow} onChange={e => update('slowWindow', e.target.value)} /></label></div>
        <label>Stock universe<select value={form.universe} onChange={e => update('universe', e.target.value)}><option value="custom">Custom symbols</option><option value="sp500">S&amp;P 500</option></select></label>
        {form.universe === 'custom' ? <label>Symbols<input value={form.symbols} onChange={e => update('symbols', e.target.value)} placeholder="AAPL, MSFT, NVDA" /><span className="small-text">Up to 500 U.S. stock symbols.</span></label> : <p className="small-text">The S&amp;P 500 membership snapshot currently available in TickrTalk will be used.</p>}
        <div className="backtest-fields two"><label>From<input type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} /></label><label>Through<input type="date" value={form.endDate} max={today} onChange={e => update('endDate', e.target.value)} /></label></div>
        <div className="backtest-guard"><ShieldCheck size={18} /><span>Long-only stocks · no shorting · no options or futures · no margin</span></div>
        <Button type="submit" disabled={busy || !health?.ready || jobs.some(job => ['queued', 'running'].includes(job.status))}><Play size={16} weight="fill" />{busy ? 'Starting…' : 'Run backtest'}</Button>
        <p className="small-text">Engine {health?.engine ?? 'Vibe-Trading'} {health?.version ?? '0.1.18'} · Installed only in the isolated cloud runtime.</p>
      </form>
      <section className="backtest-results">
        <div className="backtest-title"><div><span>RESULTS</span><h2>{selected?.status === 'running' || selected?.status === 'queued' ? selected.stage : selected?.status === 'completed' ? 'Backtest report' : 'Your research, at a glance'}</h2></div>{selected?.status ? <span className={`environment-tag ${selected.status === 'completed' ? 'paper' : ''}`}>{selected.status}</span> : null}</div>
        {!selected ? <div className="backtest-empty"><ChartLineIcon /><h3>One idea at a time.</h3><p>Choose a strategy and run it across your selected stock universe.</p></div> : null}
        {selected?.status === 'failed' ? <Notice warning>{selected.error ?? 'The backtest stopped before producing results.'}</Notice> : null}
        {selected && ['running', 'queued'].includes(selected.status) ? <div className="backtest-progress"><span className="loader-dot" /><p>{selected.stage || 'Preparing your backtest…'}</p><span>Keep this page open or return to your owner studio later.</span></div> : null}
        {selected?.status === 'completed' && !result && detailLoadingId === selected.id ? <div className="backtest-progress"><span className="loader-dot" /><p>Loading this report…</p></div> : null}
        {result ? <>
          {strategyReport ? <section className="backtest-strategy-summary" aria-labelledby="backtest-strategy-title"><div className="backtest-strategy-heading"><span>STRATEGY &amp; TEST SETUP</span><h3 id="backtest-strategy-title">{strategyReport.strategyName}</h3></div><div className="backtest-strategy-grid"><div><strong>Entry</strong><p>{strategyReport.entry}</p></div><div><strong>Exit</strong><p>{strategyReport.exit}</p></div><div><strong>Stocks used</strong><p>{strategyReport.stockCount}</p></div><div><strong>Parameters</strong><p>{strategyReport.parameters}</p></div></div></section> : null}
          <div className="backtest-metrics">{[['Total return', metrics.total_return ?? metrics.totalReturn, true], ['Annualized return', annualizedReturnDecimal(result), true], ['Maximum drawdown', metrics.max_drawdown ?? metrics.maxDrawdown, true], ['Sharpe ratio', metrics.sharpe_ratio ?? metrics.sharpeRatio ?? metrics.sharpe, false]].map(([label, value, percent]) => <div key={String(label)}><span>{String(label)}</span><strong>{pretty(value, Boolean(percent))}</strong></div>)}</div>
          {interpretation ? <section className="backtest-interpretation" aria-labelledby="backtest-interpretation-title"><div><span>RESEARCH READOUT</span><h3 id="backtest-interpretation-title">{interpretation.verdict}</h3><p>{interpretation.rationale}</p></div>{interpretation.evidence.length ? <div><strong>What the results show</strong><ul>{interpretation.evidence.map(item => <li key={item}>{item}</li>)}</ul></div> : null}<div><strong>Limits to keep in mind</strong><ul>{interpretation.caveats.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></section> : null}
          {chart ? <div className="backtest-chart-wrap"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Simulated portfolio value over the backtest period"><polyline points={chart} fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" /></svg><div><span>{String(result.request?.startDate ?? '')}</span><span>{String(result.request?.endDate ?? '')}</span></div></div> : null}
          <div className="backtest-coverage"><strong>Data coverage</strong><span>{result.coverage?.included?.length ?? 0} of {result.coverage?.requested?.length ?? 0} symbols included · {String(result.feed ?? '').toUpperCase()} feed</span>{result.coverage?.excluded?.length ? <details><summary>Review excluded symbols</summary><p>{result.coverage.excluded.join(', ')}</p></details> : null}</div>
          {result.warnings?.length ? <Notice warning>{result.warnings.map(String).join(' ')}</Notice> : null}
          <div className="backtest-table-heading"><h3>Simulated trades</h3><span>Latest {Math.min(result.trades?.length ?? 0, 250)} fills</span></div>
          <div className="backtest-table-scroll"><table><thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Shares</th><th>Fill price</th><th>Profit / loss</th></tr></thead><tbody>{(result.trades ?? []).slice(-50).reverse().map((trade, index) => <tr key={String(trade.id ?? index)}>{['date', 'symbol', 'side', 'quantity', 'price', 'pnl'].map(key => <td key={key}>{trade[key] ?? '—'}</td>)}</tr>)}</tbody></table></div>
          <p className="small-text">Results reflect the selected price feed and simplified slippage assumptions. They do not include a guarantee of availability, execution quality, or future performance.</p>
        </> : null}
        {jobs.length > 0 ? <div className="backtest-history"><label>Recent backtests<select value={selected?.id ?? ''} onChange={e => setSelectedId(e.target.value)}>{jobs.map(job => <option key={job.id} value={job.id}>{new Date(job.createdAt).toLocaleString()} · {job.status}</option>)}</select></label></div> : null}
      </section>
    </div>
  </>
}

function ChartLineIcon() { return <FloppyDisk size={30} weight="light" /> }
