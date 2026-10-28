'use client'

import {useEffect,useMemo,useState} from 'react'

import {useAuth} from '@clerk/nextjs'

import {AccountFilter,useRememberedAccounts} from './account-filter'

import { ArrowUpRight, ArrowsClockwise, CalendarBlank, Info, MagnifyingGlass, NotePencil } from '@phosphor-icons/react'

import {CapitalChart} from './capital-chart'

import {capitalOverview} from '@/lib/workspace/capital.mjs'

import { portfolioSeries } from '@/lib/workspace/sample-data'

import { summarizeHoldings, unrealized } from '@/lib/workspace/finance.mjs'

import type { Holding, Trade } from '@/lib/workspace/types'

import type { WorkspaceProps } from './workspace-app'

import { BrandAvatar, Button, dateLabel as defaultDateLabel, EmptyState, ExportButton, Modal, money as formatMoney, PageHeader, PerformanceChart, StatusBadge } from './primitives'



const chartLabels = Array.from({ length: 25 }, (_, i) => new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' }).format(new Date(2024, 9 + i, 13)))

export function JournalView(props:WorkspaceProps){

  return props.demo?<JournalContent {...props} storageKey="tickrtalk:journal-accounts:v1:demo"/>:<AuthenticatedJournal {...props}/>

}

function AuthenticatedJournal(props:WorkspaceProps){

  const {userId}=useAuth()

  return <JournalContent {...props} storageKey={userId?'tickrtalk:journal-accounts:v1:'+userId:null}/>

}

function JournalContent(props:WorkspaceProps & {storageKey:string|null}){

 const [savedCurrency,setSavedCurrency]=useState({key:props.storageKey,value:'USD'})

 const currencies=[...new Set(['USD',...props.accounts.map(a=>a.currency??'USD')])].sort()

 const currency=savedCurrency.key===props.storageKey&&currencies.includes(savedCurrency.value)?savedCurrency.value:'USD'

 useEffect(()=>{if(!props.storageKey)return;try{const value=localStorage.getItem(props.storageKey+':currency');if(value&&/^[A-Z]{3}$/.test(value))setSavedCurrency({key:props.storageKey,value})}catch{}},[props.storageKey])

 function chooseCurrency(value:string){setSavedCurrency({key:props.storageKey,value});if(props.storageKey)try{localStorage.setItem(props.storageKey+':currency',value)}catch{}}

 return <JournalCurrencyView {...props} currency={currency} currencies={currencies} chooseCurrency={chooseCurrency}/>

}

function JournalCurrencyView(props:WorkspaceProps & {storageKey:string|null;currency:string;currencies:string[];chooseCurrency:(currency:string)=>void}) {

  const {demo,navigate,showScreen,screens,toast,currency}=props

 const holdings=useMemo(()=>props.holdings.filter(h=>(h.currency??'USD')===currency),[props.holdings,currency])

 const trades=useMemo(()=>props.trades.filter(t=>(t.currency??'USD')===currency),[props.trades,currency])

 const accounts=useMemo(()=>{

 const filtered=props.accounts.filter(a=>(a.currency??'USD')===currency)

 if(!demo)return filtered

 const total=filtered.reduce((sum,a)=>sum+a.balance,0)

 return filtered.map(a=>{const factor=total?a.balance/total:0;return {...a,accountValue:a.balance,capital:{estimated:false,flowsComplete:true,flows:[{date:'2025-06-13',amount:3500*factor},{date:'2026-02-13',amount:3500*factor}],points:portfolioSeries.map((v,i)=>({date:new Date(Date.UTC(2024,9+i,13)).toISOString().slice(0,10),value:(60000+(i>=8?3500:0)+(i>=16?3500:0)+v/portfolioSeries.at(-1)!*(total-67000))*factor}))}}})

 },[props.accounts,currency,demo])

 const money=(value:number|null,signed=false)=>formatMoney(value,signed,currency)

 const dateLabel=(date:string)=>currency==='INR'?new Intl.DateTimeFormat('en-IN',{month:'short',day:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(date)):defaultDateLabel(date)

  const [account,setAccount]=useRememberedAccounts(props.storageKey?(currency==='USD'?props.storageKey:props.storageKey+':'+currency):null)

  const includesAccount=(id:string)=>account===null||account.includes(id)

  function toggleAccount(id:string){const current=account??accounts.map(a=>a.id);setAccount(current.includes(id)?current.filter(value=>value!==id):[...current,id])}

  const [range, setRange] = useState('2y')

  const [chartMode,setChartMode]=useState('value')

  const [tab, setTab] = useState('overview')

  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState<Trade | null>(null)

  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null)

  const [note, setNote] = useState('')

  const [refreshing, setRefreshing] = useState(false)

  const selectedHoldings = useMemo(() => holdings.filter(h => account === null || account.includes(h.account)), [holdings, account])

  const cutoff = useMemo(() => { const date = demo ? new Date('2026-10-13T23:59:59Z') : new Date(); date.setUTCMonth(date.getUTCMonth() - (range === '1m' ? 1 : range === '3m' ? 3 : range === '6m' ? 6 : range === '1y' ? 12 : 24)); return date }, [demo, range])

  const scopeTrades = useMemo(() => trades.filter(t => t.mode === 'real' && new Date(t.date) >= cutoff && (account === null || account.includes(t.account))), [trades, account, cutoff])

  const selectedTrades = useMemo(() => scopeTrades.filter(t => `${t.symbol} ${t.broker}`.toLowerCase().includes(search.toLowerCase())), [scopeTrades, search])

  const summary = summarizeHoldings(selectedHoldings)

  const unrealizedValue=!selectedHoldings.length||selectedHoldings.every(h=>unrealized(h)===null)?null:summary.unrealized

  const values = useMemo(() => {

    if(account?.length===0)return []

    if (!demo) { let total = 0; return [...scopeTrades].reverse().filter(t => t.pnl != null).map(t => total += t.pnl ?? 0) }

    const count = range === '1m' ? 2 : range === '3m' ? 4 : range === '6m' ? 7 : range === '1y' ? 13 : 25

    const factor = account===null?1:(account.includes('alpaca')?.68:0)+(account.includes('schwab')?.32:0)

    const part = portfolioSeries.slice(-count)

    const base = part[0]

    return part.map(v => (v - (count === 25 ? 0 : base)) * factor)

  }, [demo, range, account, scopeTrades])

  const labels = useMemo(() => demo ? chartLabels.slice(-values.length) : [...scopeTrades].reverse().filter(t => t.pnl != null).map(t => dateLabel(t.date)), [demo, values.length, scopeTrades])

  const realized = account?.length===0?null:demo||scopeTrades.some(t=>t.pnl!==null)?values.at(-1)??0:null

  const capital=useMemo(()=>capitalOverview(accounts.filter(a=>account===null||account.includes(a.id)),cutoff.toISOString().slice(0,10)),[accounts,account,cutoff])

  const periodLabel=capital.points.length?`${capital.points[0].date} to ${capital.points.at(-1)!.date}`:''

  function openTrade(t: Trade) { setSelected(t); setNote(localStorage.getItem(`tickrtalk:note:${t.id}`) ?? '') }

  async function refresh() {setRefreshing(true);try{if(!demo)await props.refreshData?.();toast(demo?'Sample workspace refreshed. No brokerage requests were made.':'Account data reloaded. Balances reflect your broker’s latest available sync.')}catch{toast('Account data could not be reloaded. Please try again.')}finally{setRefreshing(false)}}
  return <>

    <PageHeader title="Your money. Your progress." description="See what you have. Understand how it grows." />

    {props.currencies.length>1?<div className="journal-currency-row"><div role="group" aria-label="Journal currency">{props.currencies.map(code=><button key={code} aria-pressed={currency===code} onClick={()=>props.chooseCurrency(code)}>{code==='INR'?'INR · ₹':code==='USD'?'USD · $':code}</button>)}</div><span>Separate totals in each account’s currency. No conversion.</span></div>:null}

    <div className="journal-toolbar"><div className="toolbar-controls"><label className="select-control"><CalendarBlank size={16} /><select aria-label="Performance date range" value={range} onChange={e => setRange(e.target.value)}><option value="2y">{demo ? 'Oct 13, 2024 – Oct 13, 2026' : 'Last two years'}</option><option value="1y">Last 12 months</option><option value="6m">Last 6 months</option><option value="3m">Last 3 months</option><option value="1m">Last month</option></select></label><AccountFilter accounts={accounts} selection={account} onChange={setAccount}/></div><button className="refresh-label" onClick={refresh} disabled={refreshing}><ArrowsClockwise size={14} className={refreshing ? 'spinning' : ''} />{refreshing ? 'Refreshing' : demo ? 'Sample history · Oct 13, 2026' : 'Connected account history'}</button></div>

    <section className="capital-section" aria-label="Account value and investment progress">

      <div className={`capital-headline ${Math.max(money(capital.current).length,money(capital.gain,true).length)>12?'long-values':''}`}><div><div className="metric-label">{capital.currentEstimated?'Estimated account value':'Account value'} <span title={capital.currentEstimated?'Calculated from cash and priced holdings reported by your connection.':'The total reported by your broker, including cash and investments. Buying power is not account value.'}><Info size={15}/></span></div><strong className="capital-amount">{money(capital.current)}</strong><span className="metric-detail">{capital.current!==null?(demo?'Cash + investments · sample balances':capital.currentEstimated?'Cash + priced holdings · latest available data':'Cash + investments · latest broker balance'):capital.selected?`Total available for ${capital.known} of ${capital.selected} selected accounts`:'Choose accounts to see your value'}</span></div><div><div className="metric-label">Investment result <span title="Ending value minus starting value and net deposits over the chart period. Includes market movements, income and fees. This is not realized trading P&L."><Info size={15}/></span></div><strong className={`capital-amount ${capital.gain===null?'unavailable':capital.gain<0?'loss':'gain'}`}>{money(capital.gain,true)}</strong><span className="metric-detail">{capital.complete?'After net contributions · chart period':'Needs value and contribution history'}</span></div></div>

      <div className="capital-chart-toolbar"><div className="capital-view-switch" role="group" aria-label="Chart view"><button aria-pressed={chartMode==='value'} onClick={()=>setChartMode('value')}>Account value</button><button aria-pressed={chartMode==='profit'} onClick={()=>setChartMode('profit')}>Realized P&L</button></div><div className="capital-ranges" role="group" aria-label="Chart time range">{[['1m','1M'],['3m','3M'],['6m','6M'],['1y','1Y'],['2y','2Y']].map(([value,label])=><button key={value} aria-pressed={range===value} onClick={()=>setRange(value)}>{label}</button>)}</div></div>

      {chartMode==='value'?<>

        {capital.points.length>1?<><CapitalChart points={capital.points} baseline={capital.baseline} currency={currency}/><div className="chart-caption capital-caption"><span>{demo?'Illustrative account values':capital.estimated?'Estimated broker history':'Broker account history'} · {currency}</span><span>{periodLabel}</span></div>{!capital.complete?<p className="capital-explanation">Contribution history is incomplete. Account values are shown without a gain estimate or contribution comparison.</p>:null}</>:<EmptyState title={!capital.selected?'Choose accounts to see your progress':'Account value history isn’t available yet'} description={capital.selected?(capital.selected>1?'A combined chart needs dated balances for every selected account. Your current balance and trading P&L remain separate. Try selecting another account, or view realized P&L.':'Your broker connection hasn’t shared historical account values. Your current balance is shown above. You can still view realized P&L.'):'Select one or more accounts above.'} action={capital.selected?<Button secondary onClick={()=>setChartMode('profit')}>View realized P&L</Button>:undefined}/>}

        {capital.complete?<><div className="capital-equation"><div><span>Starting value</span><strong>{money(capital.start)}</strong></div><span aria-hidden="true">+</span><div><span>Net deposits</span><strong>{money(capital.netDeposits)}</strong></div><span aria-hidden="true">+</span><div><span>Investment result</span><strong className={capital.gain!<0?'loss':'gain'}>{money(capital.gain,true)}</strong></div><span aria-hidden="true">=</span><div><span>Ending value</span><strong>{money(capital.end)}</strong></div></div><p className="capital-explanation">Contributions are separate from gains. Withdrawals reduce net deposits. Investment result includes market movements, income and fees. {demo?'Illustrative figures.':'Based on the broker history available for '+periodLabel+'.'}</p></>:null}

      </>:<>{values.length>1?<PerformanceChart values={values} labels={labels} currency={currency}/>:<EmptyState title="No matched trade history in this period" description="Realized P&L needs matched buy and sell transactions with a known cost basis."/>}<div className="chart-caption"><span>Realized trading P&L · {currency} · FIFO</span><span>{demo?'Illustrative performance':'Based on available matched trades'}</span></div></>}

      <div className="capital-profit-metrics"><div><div className="metric-label">Realized P&L <span title="Matched closed trades over the selected period. Deposits are excluded."><Info size={14}/></span></div><strong className={realized!==null&&realized<0?'loss':'gain'}>{money(realized,true)}</strong><span className="metric-detail">Over the selected period</span></div><div><div className="metric-label">Current unrealized P&L <span title="Open positions today, with known cost basis. This is not the change in unrealized P&L over the chart period."><Info size={14}/></span></div><strong className={summary.unrealized<0?'loss':'gain'}>{money(unrealizedValue,true)}</strong><span className="metric-detail">{summary.incomplete?'Known cost basis only':'Across your open positions today'}</span></div><p>Closed trades and open positions give you two perspectives on performance. They don’t replace the account value calculation.</p></div>

    </section>

    <div className="tabs-row"><div className="text-tabs" role="tablist" aria-label="Journal sections">{['overview', 'holdings', 'history'].map(t => <button role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} key={t} onClick={() => setTab(t)}>{t === 'overview' ? 'Overview' : t === 'holdings' ? 'Open positions' : 'Trade history'}</button>)}</div><ExportButton rows={tab === 'holdings' ? selectedHoldings.map(h => ({ Symbol: h.symbol, Broker: h.broker, Quantity: h.quantity, ['Current value '+currency]: h.price * h.quantity, ['Unrealized P&L '+currency]: unrealized(h) })) : selectedTrades.map(t => ({ Date: t.date, Symbol: t.symbol, Broker: t.broker, Side: t.side, Quantity: t.quantity, ['Fill price '+currency]: t.price, ['Realized P&L '+currency]: t.pnl }))} filename={`tickrtalk-journal-${currency}.csv`} /></div>

    {tab === 'holdings' ? <><div className="section-heading"><h2>Your open positions</h2><button className="text-link" onClick={() => navigate('screening')}>Screen portfolio <ArrowUpRight size={14} /></button></div><div className="table-wrap"><table className="ws-table holdings-table"><thead><tr><th>Stock</th><th>Account</th><th className="numeric">Shares</th><th className="numeric">Avg. cost</th><th className="numeric">Current value</th><th className="numeric">Unrealized P&L</th></tr></thead><tbody>{selectedHoldings.map(h => <tr key={`${h.symbol}-${h.account}`}><td><div className="stock-cell"><BrandAvatar symbol={h.symbol} /><div><div className="symbol-line"><button className="stock-detail-button" onClick={() => setSelectedHolding(h)} aria-label={`View ${h.symbol} position`}>{h.symbol}</button><StatusBadge status={screens[h.symbol]?.status ?? 'unavailable'} onClick={() => showScreen(h.symbol)} /></div><span>{h.name}</span></div></div></td><td>{h.broker}<span className="cell-subtext">••{accounts.find(a => a.id === h.account)?.lastFour ?? 'Account'}</span></td><td className="numeric">{h.quantity}</td><td className="numeric">{money(h.cost)}</td><td className="numeric">{money(h.quantity * h.price)}</td><td className={`numeric ${unrealized(h) == null ? 'muted' : unrealized(h)! < 0 ? 'loss' : 'gain'}`}>{money(unrealized(h), true)}</td></tr>)}</tbody></table></div>{!selectedHoldings.length ? <EmptyState title="No positions yet" description="Open positions will appear when your account data is available." /> : null}<p className="table-footnote">Screening badges reflect current assessments. Missing cost basis is excluded from P&L totals.</p></> : <><div className="section-heading"><div><h2>{tab === 'history' ? 'Your trading history' : 'Recent transactions'}</h2><p>Every trade is an opportunity to learn.</p></div>{tab === 'history' ? <label className="search-control compact-search"><MagnifyingGlass size={16} /><input placeholder="Search symbol or broker" aria-label="Search trade history" value={search} onChange={e => setSearch(e.target.value)} /></label> : <button className="text-link" onClick={() => setTab('history')}>View all trades <ArrowUpRight size={14} /></button>}</div><div className="table-wrap"><table className="ws-table history-table"><thead><tr><th>Stock</th><th>Account</th><th>Date</th><th>Side</th><th className="numeric">Shares</th><th className="numeric">Fill price</th><th className="numeric">Realized P&L</th><th aria-label="Trade detail" /></tr></thead><tbody>{selectedTrades.slice(0, tab === 'overview' ? 4 : 100).map(t => <tr key={t.id}><td><div className="stock-cell"><BrandAvatar symbol={t.symbol} /><div><strong>{t.symbol}</strong><span>{t.name}</span></div></div></td><td>{t.broker}<span className="cell-subtext">{t.origin === 'algo' ? 'Algo trade' : 'Your trade'}</span></td><td>{dateLabel(t.date)}<span className="cell-subtext">{new Date(t.date).getFullYear()}</span></td><td><span className={`side-label ${t.side.toLowerCase()}`}>{t.side}</span></td><td className="numeric">{t.quantity}</td><td className="numeric">{money(t.price)}</td><td className={`numeric ${t.pnl == null ? 'muted' : t.pnl < 0 ? 'loss' : 'gain'}`}>{t.pnl == null ? 'Open position' : money(t.pnl, true)}</td><td><button className="icon-button" aria-label={`Open ${t.symbol} trade journal`} onClick={() => openTrade(t)}><NotePencil size={18} /></button></td></tr>)}</tbody></table></div>{!selectedTrades.length ? <EmptyState title="No matching transactions" description="Try another account or search term." /> : null}<p className="table-footnote">{demo ? 'Recent sample transactions are shown. The performance chart includes earlier illustrative history.' : 'Actual filled transactions from connected accounts. Unknown cost basis is not treated as zero.'}</p></>}

    {selectedHolding ? <Modal title={`${selectedHolding.symbol} · Your position`} onClose={() => setSelectedHolding(null)}><div className="trade-detail-grid"><div><span>Account</span><strong>{selectedHolding.broker}</strong></div><div><span>Shares</span><strong>{selectedHolding.quantity}</strong></div><div><span>Average cost</span><strong>{money(selectedHolding.cost)}</strong></div><div><span>Current price</span><strong>{money(selectedHolding.price)}</strong></div><div><span>Current value</span><strong>{money(selectedHolding.price * selectedHolding.quantity)}</strong></div><div><span>Unrealized P&L</span><strong>{money(unrealized(selectedHolding), true)}</strong></div></div><StatusBadge status={screens[selectedHolding.symbol]?.status ?? 'unavailable'} onClick={() => { setSelectedHolding(null); showScreen(selectedHolding.symbol) }} /><p className="small-text">Current screening assessment. Missing cost basis is not treated as zero.</p></Modal> : null}

    {selected ? <Modal title={`${selected.symbol} · Trade journal`} onClose={() => setSelected(null)}><div className="trade-detail-grid"><div><span>Account</span><strong>{selected.broker}</strong></div><div><span>Filled</span><strong>{dateLabel(selected.date)}</strong></div><div><span>Shares</span><strong>{selected.quantity}</strong></div><div><span>Fill price</span><strong>{money(selected.price)}</strong></div><div><span>Realized P&L</span><strong className={selected.pnl != null && selected.pnl < 0 ? 'loss' : 'gain'}>{selected.pnl == null ? 'Not yet realized' : money(selected.pnl, true)}</strong></div><div><span>Origin</span><strong>{selected.origin === 'algo' ? 'Automated trade' : 'Your trade'}</strong></div></div><label className="field-label" htmlFor="trade-note">Your reflection</label><textarea id="trade-note" rows={5} placeholder="What worked? What would you do differently?" value={note} onChange={e => setNote(e.target.value)} /><p className="small-text">{demo ? 'Saved in this browser for the sample workspace.' : 'Personal notes are currently stored in this browser.'}</p><div className="modal-actions"><Button secondary onClick={() => setSelected(null)}>Close</Button><Button onClick={() => { localStorage.setItem(`tickrtalk:note:${selected.id}`, note); toast('Your reflection has been saved in this browser.'); setSelected(null) }}>Save reflection</Button></div></Modal> : null}

  </>

}

