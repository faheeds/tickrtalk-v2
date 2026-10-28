'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { MagnifyingGlass, BookOpen, ChartLineUp, Scales, PlugsConnected, GearSix, ArrowUpRight, ArrowRight, CaretDown, CaretRight, Bell, Circle, Check, X, Info, ShieldCheck, SignOut, Sparkle, Crown } from '@phosphor-icons/react'
import { holdings as sampleHoldings, accounts as sampleAccounts, trades as sampleTrades, sampleScreen } from '@/lib/workspace/sample-data'
import type { Account, Holding, Screening, Trade, View } from '@/lib/workspace/types'
import { Button, Modal, Notice, StatusBadge } from './primitives'
import { JournalView } from './journal'
import {mergeScreenings} from '@/lib/workspace/screening-state.mjs'
import {useSavedScreenings} from './use-saved-screenings'
import {AccountSessionActions} from './account-session'
import { VibeBacktestStudio } from './vibe-backtest-studio'
const ResearchView = dynamic(() => import('./research').then(module => module.ResearchView), {loading: () => <p className="loading-placeholder">Loading research…</p>})
import { AlgoView } from './algo'
import { ScreeningView, ScreeningReport } from './screening'
import { AccountsView, HelpView, OwnerView, PlansView, SettingsView } from './secondary'
import './workspace.css'

const navigation = [{ view: 'research', label: 'Research', Icon: MagnifyingGlass }, { view: 'journal', label: 'Journal', Icon: BookOpen }, { view: 'algo', label: 'Algo Trading', Icon: ChartLineUp }, { view: 'screening', label: 'AAOIFI Screening', Icon: Scales }] as const
export interface WorkspaceProps {
  demo: boolean; localServices?:boolean; refreshData?:()=>Promise<void>; holdings: Holding[]; accounts: Account[]; trades: Trade[]; screens: Record<string, Screening>;
  navigate: (view: View) => void; showScreen: (symbol: string) => void; toast: (message: string) => void; setScreens: (results: Record<string, Screening>) => void;
}
export default function WorkspaceApp({ view = 'journal', demo = false,localServices=false }: { view?: View; demo?: boolean;localServices?:boolean }) {
  const router = useRouter()
  const paperWorkspace = demo && localServices && (view === 'algo' || view === 'owner')
  const needsWorkspaceData = !['owner', 'ownerBacktests'].includes(view)
  const [menu, setMenu] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [message, setMessage] = useState('')
  const [data, setData] = useState<{ holdings: Holding[]; accounts: Account[]; trades: Trade[] }>({ holdings: demo ? sampleHoldings : [], accounts: demo ? sampleAccounts : [], trades: demo ? sampleTrades : [] })
  const [screens, setScreenState] = useState<Record<string, Screening>>(() => demo ? Object.fromEntries(sampleHoldings.map(h => [h.symbol, sampleScreen(h.symbol)!])) : {})
  const [selectedScreen, setSelectedScreen] = useState<string | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(!demo && needsWorkspaceData)
  const navigate = useCallback((next: View) => { setMenu(false); router.push(next === 'ownerBacktests' ? '/dashboard/owner/backtests' : `${demo ? '/preview' : '/dashboard'}/${next}`) }, [demo, router])
  useEffect(() => { if (!message) return; const id = window.setTimeout(() => setMessage(''), 4500); return () => window.clearTimeout(id) }, [message])
  useEffect(() => {
    if (demo || !needsWorkspaceData) { setLoading(false); return }
    const controller = new AbortController()
    fetch('/api/workspace?currencies=native', { signal: controller.signal }).then(async r => { const json = await r.json(); if (!r.ok) throw new Error(json.error ?? 'Could not load accounts'); setData(json); setLoadError(json.warning ?? '') }).catch(e => { if (e.name !== 'AbortError') setLoadError(e.message) }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [demo, needsWorkspaceData])
  const refreshData=useCallback(async()=>{
    if(demo)return
    const response=await fetch('/api/workspace?currencies=native',{cache:'no-store'})
    const json=await response.json()
    if(!response.ok)throw new Error('Account balances could not be reloaded. Try again shortly.')
    setData(json);setLoadError(json.warning??'')
  },[demo])
  const setScreens = useCallback((next: Record<string, Screening>) => setScreenState(prev => mergeScreenings(prev,next)), [])
  const screenSyncError=useSavedScreenings(demo,setScreens)
  const showScreen = useCallback((symbol: string) => setSelectedScreen(symbol), [])
  const props: WorkspaceProps = { demo,localServices,refreshData, ...data, screens, setScreens, navigate, showScreen, toast: setMessage }
  const displayName = view === 'screening' ? 'AAOIFI Screening' : view === 'algo' ? 'Algo Trading' : view === 'owner' ? 'Owner console' : view === 'ownerBacktests' ? 'Backtest studio' : view.charAt(0).toUpperCase() + view.slice(1)
  return <div className="workspace">
    <aside className="ws-sidebar"><Link href="/" className="ws-brand"><span>Tickr</span>Talk<span className="brand-period">.</span></Link><div className="sidebar-label">YOUR WORKSPACE</div><nav aria-label="Primary navigation">{navigation.map(({ view: key, label, Icon }) => <Link key={key} href={`${demo ? '/preview' : '/dashboard'}/${key}`} aria-current={view === key ? 'page' : undefined} className={view === key ? 'active' : ''}><Icon size={20} weight={view === key ? 'duotone' : 'regular'} /><span>{label}</span></Link>)}</nav>
    <div className="sidebar-bottom"><div className="plan-teaser"><div className="teaser-icon"><Sparkle size={19} /></div><strong>A little more perspective.</strong><p>Explore everything TickrTalk can do for you.</p><button onClick={() => navigate('plans')}>Explore plans <ArrowUpRight size={14} /></button></div><nav aria-label="Account navigation"><button className={view === 'accounts' ? 'active' : ''} onClick={() => navigate('accounts')}><PlugsConnected size={19} /> Accounts</button><button className={view === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><GearSix size={19} /> Settings</button></nav><div className="sidebar-profile"><div className="avatar">{paperWorkspace ? 'ME' : demo ? 'JD' : 'ME'}</div><div><strong>{paperWorkspace ? 'Your paper workspace' : demo ? 'Jamie Davis' : 'Your account'}</strong><span>{paperWorkspace ? 'Local workspace' : demo ? 'Sample workspace' : 'Personal workspace'}</span></div><button className="icon-button" aria-label="Open account menu" onClick={() => setMenu(!menu)}><CaretDown size={16} /></button></div></div></aside>
    <div className="ws-content"><header className="ws-topbar"><div className="breadcrumb"><span>Workspace</span><CaretRight size={13} /><strong>{displayName}</strong></div><Link href="/" className="ws-brand mobile-brand"><span>Tickr</span>Talk<span className="brand-period">.</span></Link><div className="topbar-actions">{demo ? <span className="sample-pill"><Circle size={7} weight="fill" /> {paperWorkspace ? 'Local workspace' : 'Sample workspace'}</span> : null}<button className="icon-button notification-button" onClick={() => setNotifications(true)} aria-label="View notifications"><Bell size={20} /><span className="notification-dot" /></button><button className="avatar small-avatar" onClick={() => setMenu(!menu)} aria-label="Open account menu" aria-expanded={menu}>{paperWorkspace ? 'ME' : demo ? 'JD' : 'ME'}</button></div>
    {menu ? <div className="account-menu"><strong>{paperWorkspace ? 'Your paper workspace' : demo ? 'Jamie Davis' : 'Your account'}</strong><span>{paperWorkspace ? 'Connected paper account' : demo ? 'Exploring with sample data' : 'Manage your workspace'}</span>{[{ view: 'accounts', title: 'Connected accounts' }, { view: 'plans', title: 'Plans & billing' }, { view: 'settings', title: 'Settings' }, { view: 'help', title: 'Help & methodology' }].map(item => <button key={item.view} onClick={() => navigate(item.view as View)}>{item.title}<ArrowUpRight size={14} /></button>)}{demo ? <>{localServices?<button onClick={() => navigate('owner')}>Owner console <ShieldCheck size={15} /></button>:null}<Link href="/sign-in">Sign in to your account <ArrowRight size={15}/></Link><Link href="/sign-up">Create your account <ArrowRight size={15} /></Link></> : <><AccountSessionActions/><Link href="/">Back to home <ArrowUpRight size={15} /></Link></>}</div> : null}</header>
    <main className="ws-main" id="main-content">{demo&&!localServices?<Notice>This public preview uses sample data. Account connections, live research and automated trading are not available here yet.</Notice>:null}{loadError ? <Notice warning>{loadError}</Notice> : null}{screenSyncError?<Notice warning>{screenSyncError}</Notice>:null}{loading ? <div className="loading-placeholder" role="status">Loading your workspace…</div> : view === 'journal' ? <JournalView {...props} /> : view === 'research' ? <ResearchView {...props} /> : view === 'algo' ? <AlgoView {...props} /> : view === 'screening' ? <ScreeningView {...props} /> : view === 'accounts' ? <AccountsView {...props} /> : view === 'plans' ? <PlansView {...props} /> : view === 'settings' ? <SettingsView {...props} /> : view === 'help' ? <HelpView {...props} /> : view === 'ownerBacktests' ? <VibeBacktestStudio {...props} /> : <OwnerView {...props} />}
    <footer className="workspace-footer"><span><ShieldCheck size={14} /> Your perspective. Your decisions.</span><span>{paperWorkspace ? 'Paper activity is separate from the sample walkthrough' : demo ? 'Illustrative data and screening results' : 'Past performance does not predict future results'}<button onClick={() => navigate('help')}>Methodology <ArrowUpRight size={12} /></button></span></footer></main></div>
    <nav className="ws-mobile-nav" aria-label="Mobile primary navigation">{navigation.map(({ view: key, label, Icon }) => <Link key={key} href={`${demo ? '/preview' : '/dashboard'}/${key}`} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined}><Icon size={22} weight={view === key ? 'duotone' : 'regular'} /><span>{key === 'screening' ? 'Screening' : key === 'algo' ? 'Algo' : label}</span></Link>)}</nav>
    {message ? <div className="ws-toast" role="status"><Check size={17} /><span>{message}</span><button onClick={() => setMessage('')} aria-label="Dismiss notification"><X size={16} /></button></div> : null}
    {selectedScreen ? <Modal title="Stock screening report" onClose={() => setSelectedScreen(null)} wide><ScreeningReport symbol={selectedScreen} {...props} /></Modal> : null}
    {notifications ? <Modal title="Your activity" onClose={() => setNotifications(false)}><div className="notification-list"><div><CheckCircleIcon /><div><strong>Your portfolio is up to date</strong><p>{demo ? 'Sample account history is ready to explore.' : 'Check connected accounts for their latest sync.'}</p></div></div><div><Scales size={22} /><div><strong>Know what you hold</strong><p>Screen your holdings or look up a stock.</p><button className="text-link" onClick={() => { setNotifications(false); navigate('screening') }}>Open AAOIFI Screening <ArrowRight size={15} /></button></div></div></div></Modal> : null}
    </div>
}
function CheckCircleIcon() { return <Check size={22} /> }
