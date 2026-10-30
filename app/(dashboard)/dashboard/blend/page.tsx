'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

// ─── types (mirror GET /api/blend) ────────────────────────────────────────────
interface Sleeve { label: string; blurb: string; slots: number; gated: boolean; monthly: boolean }
interface Live { id: string; sleeve: string; symbol: string; status: string; qty: number; target_qty: number; entry_price: number | null; entry_date: string | null; entry_reason: string | null; current_price: number | null; unrealized_pct: number | null }
interface Closed { id: string; sleeve: string; symbol: string; qty: number; entry_price: number | null; entry_date: string | null; exit_price: number | null; exit_date: string | null; exit_reason: string | null; return_pct: number | null }
interface Run { id: string; run_date: string; status: string; message: string | null; regime: boolean | null; data_bar: string | null; errors: string[] | null }
interface Data {
  migrated: boolean; pro: boolean
  config: { enabled: boolean; budget: number; lastRebalanceMonth: string | null }
  broker: { connected: boolean; paper: boolean | null; account: { equity: number; cash: number } | null }
  limits: { minBudget: number; maxBudget: number }
  universeSize: number
  sleeves: Record<string, Sleeve>
  stats: Record<string, { closed: number; winRate: number | null; avgReturnPct: number | null; open: number }>
  live: Live[]; closed: Closed[]; runs: Run[]
}
interface PreviewOrder { sleeve: string; side: string; symbol: string; qty: number; refPrice: number; reason: string; status: string; detail?: string }
interface Preview { status: string; message: string; regime: boolean | null; dataBar: string | null; orders: PreviewOrder[]; errors: string[] }

const usd = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const px = (v: number | null | undefined) => v === null || v === undefined ? '—' : `$${v.toFixed(2)}`
const tone = (v: number | null | undefined) => v === null || v === undefined ? 'var(--ink-1)' : v >= 0 ? 'var(--up)' : 'var(--down)'
const sp = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

export default function BlendPage() {
  const [d, setD] = useState<Data | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [prev, setPrev] = useState<Preview | null>(null)
  const [prevBusy, setPrevBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/blend', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to load')
      setD(j); setBudget(b => b || (j.config.budget ? String(j.config.budget) : ''))
    } catch (e) { setLoadErr(e instanceof Error ? e.message : 'Failed to load') }
  }, [])
  useEffect(() => { load() }, [load])

  async function save(patch: { enabled?: boolean; budget?: number }) {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/blend', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      const j = await r.json()
      if (!r.ok) setMsg({ ok: false, text: j.error ?? 'Could not save.' })
      else { setMsg({ ok: true, text: patch.enabled === true ? 'Blend is ON. First orders go out at the next market open run (~9:35 ET).' : patch.enabled === false ? 'Blend is paused. Open positions still exit on their signals.' : 'Budget saved.' }); await load() }
    } catch { setMsg({ ok: false, text: 'Network error.' }) }
    setBusy(false)
  }

  async function preview() {
    setPrevBusy(true); setPrev(null); setMsg(null)
    try {
      const b = Number(budget)
      const r = await fetch('/api/blend/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b > 0 ? { budget: b } : {}) })
      const j = await r.json()
      if (!r.ok) setMsg({ ok: false, text: j.error ?? 'Preview failed.' }); else setPrev(j.result)
    } catch { setMsg({ ok: false, text: 'Network error.' }) }
    setPrevBusy(false)
  }

  if (loadErr) return <div className="p-8"><div className="card" style={{ padding: 20, color: 'var(--down)' }}>{loadErr}</div></div>
  if (!d) return <div className="p-8" style={{ color: 'var(--ink-3)' }}>Loading…</div>

  const budgetNum = Number(budget)
  const budgetOk = Number.isFinite(budgetNum) && budgetNum >= d.limits.minBudget && budgetNum <= d.limits.maxBudget
  const canEnable = d.pro && d.migrated && d.broker.connected && d.broker.paper === true && budgetOk
  const regime = d.runs.find(r => r.regime !== null)?.regime ?? null

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto" style={{ display: 'grid', gap: 20 }}>
      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink-1)' }}>Blend</h1>
          <span className="badge" style={{ background: 'rgba(0,201,167,0.12)', color: '#00C9A7', padding: '2px 8px', borderRadius: 6, fontSize: 11 }}>PAPER TRADING ONLY</span>
        </div>
        <p style={{ color: 'var(--ink-2)', fontSize: 14, marginTop: 6, maxWidth: 760 }}>
          Four short-term and momentum sleeves run side by side on {d.universeSize} halal-screened large caps. Orders are placed once a day, shortly after the open, on your Alpaca <b>paper</b> account.
        </p>
      </div>

      <div className="card" style={{ padding: 16, borderColor: 'rgba(245,158,11,0.35)' }}>
        <b style={{ color: '#F59E0B', fontSize: 13 }}>Read this first</b>
        <p style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          In historical tests (2019–2026, with trading costs) this mix won about 65% of trades, returned about 17% a year, with a Sharpe near 1.1 and a worst drawdown of roughly −14% to −15%. It did <b>not</b> reach a −10% drawdown. These are backtest numbers on today&apos;s stock list (survivorship bias) and are optimistic. Paper trading exists to find out how it behaves for real before any money is at risk. There are no stop-losses; a market crash is handled only by the 200-day market filter that blocks new entries.
        </p>
      </div>

      {!d.migrated && <div className="card" style={{ padding: 16, color: 'var(--down)', fontSize: 13 }}>Database setup needed: run <code>supabase/migrations/20261029_blend.sql</code> in the Supabase SQL editor, then reload.</div>}
      {d.migrated && !d.pro && (
        <div className="card" style={{ padding: 16 }}>
          <p style={{ color: 'var(--ink-2)', fontSize: 13, marginBottom: 10 }}>Blend is a Pro feature.</p>
          <Link href="/dashboard/settings?tab=billing" className="btn-primary">Upgrade to Pro — $49/mo</Link>
        </div>
      )}
      {d.migrated && d.pro && !d.broker.connected && <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--ink-2)' }}>Connect an Alpaca <b>paper</b> account in <Link href="/dashboard/settings" style={{ color: 'var(--accent)' }}>Settings</Link> to use Blend.</div>}
      {d.migrated && d.pro && d.broker.connected && d.broker.paper !== true && <div className="card" style={{ padding: 16, fontSize: 13, color: 'var(--down)' }}>Your active Alpaca connection is a live account. Blend will not run on it. Switch to a paper connection in Settings.</div>}

      <div className="card" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="section-label">Status</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: d.config.enabled ? 'var(--up)' : 'var(--ink-2)' }}>{d.config.enabled ? 'Running' : 'Paused'}</div>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              Market filter (SPY above 200-day): {regime === null ? 'not yet checked' : regime ? 'ON — new entries allowed' : 'OFF — only RSI(2) sleeve may enter'}
              {d.broker.account && <> · Paper equity {usd(d.broker.account.equity)} · cash {usd(d.broker.account.cash)}</>}
            </p>
          </div>
          <button className="btn-primary" disabled={busy || (!d.config.enabled && !canEnable)} onClick={() => save({ enabled: !d.config.enabled, budget: budgetNum || undefined })}>
            {d.config.enabled ? 'Pause entries' : 'Turn on'}
          </button>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
            Budget to allocate (min {usd(d.limits.minBudget)})
            <input className="input" inputMode="numeric" value={budget} onChange={e => setBudget(e.target.value.replace(/[^\d.]/g, ''))} placeholder="100000" style={{ width: 180 }} />
          </label>
          <button className="btn-secondary" disabled={busy || !budgetOk || !d.pro} onClick={() => save({ budget: budgetNum })}>Save budget</button>
          <button className="btn-secondary" disabled={prevBusy || !d.pro || d.broker.paper !== true || !budgetOk} onClick={preview}>{prevBusy ? 'Checking…' : 'Preview today'}</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          The budget is split across 50 slots. If you also run other TickrTalk strategies on the same Alpaca account, they share its cash and exposure; a dedicated paper account keeps results clean. Pausing stops new buys only; open positions still sell on their exit signals.
        </p>
        {msg && <p style={{ fontSize: 13, color: msg.ok ? 'var(--up)' : 'var(--down)' }}>{msg.text}</p>}
      </div>

      {prev && (
        <div className="card" style={{ padding: 18 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>Preview — nothing was ordered</div>
          <p style={{ fontSize: 13, color: 'var(--ink-2)' }}>{prev.message}{prev.dataBar && <> · Data through {prev.dataBar}</>}</p>
          {prev.orders.length === 0 ? <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8 }}>No trades would be placed.</p> : (
            <Table head={['Sleeve', 'Side', 'Symbol', 'Qty', 'Ref price', 'Why']} rows={prev.orders.map(o => [
              o.sleeve, <span key="s" style={{ color: o.side === 'buy' ? 'var(--up)' : 'var(--down)' }}>{o.side.toUpperCase()}</span>, o.symbol, String(o.qty), px(o.refPrice), o.detail ? `${o.reason} (${o.detail})` : o.reason])} />
          )}
          {prev.errors.length > 0 && <p style={{ fontSize: 12, color: 'var(--down)', marginTop: 8 }}>{prev.errors.join(' · ')}</p>}
        </div>
      )}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {Object.entries(d.sleeves).map(([k, s]) => {
          const st = d.stats[k]
          return (
            <div key={k} className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 600, color: 'var(--ink-1)' }}>{s.label} <span style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 12 }}>· {s.slots} slots</span></div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '6px 0 10px', lineHeight: 1.5 }}>{s.blurb}{s.gated ? '. Needs SPY above its 200-day average.' : '.'}</p>
              <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                Open {st.open} · Closed {st.closed}<br />
                Win rate {st.winRate === null ? '—' : `${(st.winRate * 100).toFixed(0)}%`} · Avg trade {sp(st.avgReturnPct)}
              </div>
            </div>
          )
        })}
      </div>

      <Section title={`Open positions (${d.live.length})`}>
        {d.live.length === 0 ? <Empty>No positions yet.</Empty> : (
          <Table head={['Sleeve', 'Symbol', 'Status', 'Qty', 'Entry', 'Now', 'P&L']} rows={d.live.map(p => [
            d.sleeves[p.sleeve]?.label ?? p.sleeve, p.symbol, p.status.replace('_', ' '), String(p.qty || p.target_qty), px(p.entry_price), px(p.current_price),
            <span key="p" style={{ color: tone(p.unrealized_pct) }}>{sp(p.unrealized_pct)}</span>])} />
        )}
      </Section>

      <Section title="Recent closed trades">
        {d.closed.length === 0 ? <Empty>No closed trades yet.</Empty> : (
          <Table head={['Sleeve', 'Symbol', 'Entered', 'Exited', 'Return', 'Exit reason']} rows={d.closed.map(c => [
            d.sleeves[c.sleeve]?.label ?? c.sleeve, c.symbol, c.entry_date ?? '—', c.exit_date ?? '—',
            <span key="r" style={{ color: tone(c.return_pct) }}>{sp(c.return_pct)}</span>, c.exit_reason ?? ''])} />
        )}
      </Section>

      <Section title="Daily runs">
        {d.runs.length === 0 ? <Empty>No runs yet. The first one happens after you turn Blend on.</Empty> : (
          <Table head={['Date', 'Result', 'Data through', 'Notes']} rows={d.runs.map(r => [
            r.run_date, <span key="s" style={{ color: r.status === 'failed' ? 'var(--down)' : 'var(--ink-1)' }}>{r.status}</span>, r.data_bar ?? '—',
            [r.message, ...(r.errors ?? [])].filter(Boolean).join(' · ')])} />
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card" style={{ padding: 18 }}><div className="section-label" style={{ marginBottom: 10 }}>{title}</div>{children}</div>
}
function Empty({ children }: { children: React.ReactNode }) { return <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>{children}</p> }
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
        <thead><tr>{head.map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--ink-3)', fontWeight: 500 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>{r.map((c, j) => <td key={j} style={{ padding: '7px 8px', color: 'var(--ink-1)' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
