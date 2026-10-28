'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, type ChartConfiguration } from 'chart.js'
import { CheckCircle, Question, XCircle, MinusCircle, X, ArrowUpRight, WarningCircle, MagnifyingGlass } from '@phosphor-icons/react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faApple, faMicrosoft } from '@fortawesome/free-brands-svg-icons'
import {moneyInCurrency} from '@/lib/workspace/currencies.mjs'
import type { ScreenStatus } from '@/lib/workspace/types'
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip)
export function BrandAvatar({ symbol, large = false }: { symbol: string; large?: boolean }) {
  const icon = symbol === 'AAPL' ? faApple : symbol === 'MSFT' ? faMicrosoft : null
  return <span className={large ? 'company-letter' : 'stock-monogram'} aria-hidden="true">{icon ? <FontAwesomeIcon icon={icon} style={{ width: large ? 28 : 18, height: large ? 30 : 19 }} /> : symbol === 'JPM' ? 'JPM' : symbol.slice(0, 1)}</span>
}
export const money = (v:number|null,signed=false,currency='USD')=>moneyInCurrency(v,signed,currency)
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date(date))
const badges = { pass: { label: 'Halal', Icon: CheckCircle }, review: { label: 'Doubtful', Icon: Question }, fail: { label: 'Haram', Icon: XCircle }, unavailable: { label: 'Not screened', Icon: MinusCircle } }
export function StatusBadge({ status, onClick, large = false }: { status: ScreenStatus; onClick?: () => void; large?: boolean }) {
  const { label, Icon } = badges[status]
  const content = <><Icon size={large ? 21 : 14} weight="fill" aria-hidden="true" /><span>{label}</span></>
  return onClick ? <button className={`screen-badge ${status} ${large ? 'large' : ''}`} onClick={onClick} aria-label={`${label}: view screening report`}>{content}</button> : <span className={`screen-badge ${status} ${large ? 'large' : ''}`}>{content}</span>
}
export function Button({ children, onClick, secondary = false, disabled = false, className = '', type = 'button' }: { children: ReactNode; onClick?: () => void; secondary?: boolean; disabled?: boolean; className?: string; type?: 'button' | 'submit' }) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`ws-button ${secondary ? 'secondary' : ''} ${className}`}>{children}</button>
}
export function PageHeader({ eyebrow, title, description, action, mobileTitle, mobileDescription }: { eyebrow?: string; title: string; description: string; action?: ReactNode; mobileTitle?: string; mobileDescription?: string }) {
  return <header className="page-heading"><div>{eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}<h1>{mobileTitle ? <><span className="desktop-copy">{title}</span><span className="mobile-copy">{mobileTitle}</span></> : title}</h1><p>{mobileDescription ? <><span className="desktop-copy">{description}</span><span className="mobile-copy">{mobileDescription}</span></> : description}</p></div>{action ? <div className="heading-action">{action}</div> : null}</header>
}
export function Notice({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <div className={`notice ${warning ? 'warning' : ''}`}><WarningCircle size={19} aria-hidden="true" /><div>{children}</div></div>
}
export function EmptyState({ title, description, action, mobileTitle, mobileDescription }: { title: string; description: string; action?: ReactNode; mobileTitle?: string; mobileDescription?: string }) {
  return <div className="empty-state"><MagnifyingGlass size={30} weight="light" aria-hidden="true" /><h3>{title}</h3><p>{description}</p>{action}</div>
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; d?.showModal(); return () => { d?.close() } }, [])
  return <dialog ref={ref} className={`ws-modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal-title"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={22} /></button></div>{children}</dialog>
}
export function PerformanceChart({ values, labels, title = 'Realized trading P&L', compact = false,currency='USD' }: { values: number[]; labels: string[]; title?: string; compact?: boolean;currency?:string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const config: ChartConfiguration<'line'> = { type: 'line', data: { labels, datasets: [{ data: values, borderColor: '#62c9a6', backgroundColor: '#62c9a614', borderWidth: 2, fill: true, tension: .2, pointRadius: 0, pointHitRadius: 15, pointHoverRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { tooltip: { displayColors: false, backgroundColor: '#203241', titleColor: '#e8eff3', bodyColor: '#86efac', padding: 12, callbacks: { label: item => money(item.parsed.y, true,currency) } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#8297a9', maxTicksLimit: compact ? 4 : 7, maxRotation: 0, font: { size: 11 } } }, y: { border: { display: false }, grid: { color: '#223340' }, ticks: { color: '#8297a9', maxTicksLimit: 5, callback: value => new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{style:'currency',currency,notation:'compact',maximumFractionDigits:1}).format(Number(value)), font: { size: 11 } } } } } }
    const chart = new Chart(ref.current, config)
    return () => chart.destroy()
  }, [values, labels, compact,currency])
  return <div className={`performance-chart ${compact ? 'compact' : ''}`}><canvas ref={ref} role="img" aria-label={`${title}. ${values.length} observations, ending at ${money(values.at(-1) ?? 0,false,currency)}.`} /></div>
}
export function ExportButton({ rows, filename }: { rows: Record<string, unknown>[]; filename: string }) {
  function download() {
    if (!rows.length) return
    const cols = Object.keys(rows[0]); const escape = (v: unknown) => { let s = String(v ?? ''); if (/^[=+@-]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"` }
    const body = [cols.map(escape).join(','), ...rows.map(row => cols.map(col => escape(row[col])).join(','))].join('\r\n')
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
  }
  return <Button secondary onClick={download} disabled={!rows.length}>Export CSV <ArrowUpRight size={15} /></Button>
}
