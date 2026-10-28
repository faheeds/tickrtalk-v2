'use client'

import {useState} from 'react'

import {ArrowRight,CheckCircle,Circle,Pause,Play,ShieldCheck} from '@phosphor-icons/react'

import type {WorkspaceProps} from './workspace-app'

import type {PaperFill} from '@/lib/paper/types'

import {Button,EmptyState,Modal,money,Notice,PageHeader} from './primitives'

import {usePaper} from './use-paper'
import {AlgoPerformance,AlgoExecutions,StockOnlyPolicy} from './algo-performance'

const styles=[{key:'day',title:'Day Trading',duration:'Within the trading day'},{key:'swing',title:'Swing Trading',duration:'Days to weeks'},{key:'longterm',title:'Medium / Long-Term Investing',duration:'Months or longer'}]

export function PaperAlgoView({demo}:WorkspaceProps){

  const {data,error,busy,loading,action}=usePaper(),[style,setStyle]=useState('day'),[mode,setMode]=useState('paper'),[authorize,setAuthorize]=useState(false),[budget,setBudget]=useState(''),[consent,setConsent]=useState(false),[tab,setTab]=useState('fills'),[connection,setConnection]=useState(false),[key,setKey]=useState(''),[secret,setSecret]=useState('')

  const account=data?.account,chosen=styles.find(s=>s.key===style)!,orders=data?.orders.filter(o=>o.style===style)??[]

  const performance=data?.performance?.[style]
  const authorization=data?.styles?.find(a=>a.style===style)
  const running=!!authorization?.active&&!data?.worker.halt
  const styleCash=account?.cashPolicy?.styles?.[style]
  const totalAllocated=data?.totalAllocated??0
  const currentBudget=authorization?.budget??0
  const maximum=Math.max(currentBudget,Math.min((data?.release?.maxBudget??0)-totalAllocated+currentBudget,currentBudget+(data?.unallocatedCash??0)))
  const entered=Number(budget),increase=entered-currentBudget
  const validBudget=budget.trim()!==''&&Number.isFinite(entered)&&entered>=Math.max(1,currentBudget)&&entered<=maximum&&Math.abs(Math.round(entered*100)-entered*100)<1e-6
  function reviewAllocation(){setBudget(currentBudget?String(currentBudget):'');setConsent(false);setAuthorize(true)}

  const stale=!!data?.worker.heartbeat&&Date.now()>Math.max(Date.parse(data.worker.heartbeat),Date.parse(data.worker.nextCheckAt??'')||0)+90000

  return <>

    <PageHeader title="Automated investing, at your pace." mobileTitle="Algo Trading" description="Run multiple styles together. Choose how much each can invest." />

    <div className="algo-intro-row"><div><span className="eyebrow">YOUR INVESTING STYLE</span></div><div className="mode-switch" role="group" aria-label="Trading environment"><button aria-pressed={mode==='paper'} className={mode==='paper'?'active paper':''} onClick={()=>setMode('paper')}>Paper Trading <span>Simulated</span></button><button aria-pressed={mode==='real'} className={mode==='real'?'active real-active':''} onClick={()=>setMode('real')}>Real Trading</button></div></div>

    <div className="style-options" role="radiogroup" aria-label="View investing style">{styles.map((item,index)=><button key={item.key} role="radio" aria-checked={style===item.key} tabIndex={style===item.key?0:-1} className={`style-option ${style===item.key?'selected':''}`} onClick={()=>setStyle(item.key)} onKeyDown={e=>{if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();const next=(index+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+styles.length)%styles.length;setStyle(styles[next].key);(e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus()}}}><div className="style-option-title">{style===item.key?<CheckCircle size={23} weight="fill"/>:<Circle size={23}/>}<strong>{item.title}</strong></div><span>{item.duration}</span><span className="style-allocation-status">{data?.styles?.find(a=>a.style===item.key)?.active?'Active':'Not running'} · {money(data?.styles?.find(a=>a.style===item.key)?.budget??0)}</span></button>)}</div>

    <StockOnlyPolicy/>
    {error?<Notice warning>{error}</Notice>:null}

    {mode==='real'?<EmptyState title="Real Trading is not released yet." description="This release can submit orders only to Alpaca’s paper account. Live activation will require separate validation and authorization."/>:loading?<p className="loading-placeholder">Checking your paper account…</p>:<>

      {account?<div className="paper-metrics allocation-summary"><div><span>Allocated across all styles</span><strong>{money(totalAllocated)}</strong><small>{data?.styles?.filter(a=>a.active).length??0} {data?.styles?.filter(a=>a.active).length===1?'style':'styles'} active</small></div><div><span>Available to allocate</span><strong>{data?.unallocatedCash==null?'Awaiting cash check':money(data.unallocatedCash)}</strong><small>Broker cash not assigned to a style</small></div><div><span>Combined allocation limit</span><strong>{money(data?.release?.maxBudget??0)}</strong><small>Set by the app owner</small></div></div>:null}
      {!account?<section className="research-connection"><div><strong>Connect your Alpaca paper account.</strong><p>{demo?'Add your paper key and secret to the private .env.paper file. The service verifies them without exposing them here.':'Connect a paper API key and secret to start.'}</p></div>{!demo?<Button onClick={()=>setConnection(true)}>Connect paper account</Button>:null}</section>:<section className="automation-status"><div><strong>{chosen.title} · Alpaca Paper ••{account.lastFour}</strong><p className="small-text">{currentBudget?money(currentBudget)+' allocated to this style':'Choose your starting allocation'}</p><span className="running-status"><span className="status-dot"/><strong>{data?.worker.halt?'Owner halt active':stale||account.error?'Needs attention':running?account.marketOpen?'Running':'Ready for next session':currentBudget?'Paused':'Not activated'}</strong></span></div><div className="automation-controls">{running?<Button secondary disabled={busy} onClick={()=>action('pause',{style})}><Pause size={16}/>Pause this style</Button>:null}<Button disabled={busy||account?.cashPolicy?.ready!==true||!data?.release?.enabled[style]||!!data?.worker.halt||stale} onClick={reviewAllocation}><Play size={16}/>{running?'Add funds':currentBudget?'Review & resume':'Set allocation'}</Button></div></section>}

      {account?.error?<Notice warning>{account.error}</Notice>:null}

      {stale?<Notice warning>The paper worker heartbeat is stale. New activation is unavailable until it recovers.</Notice>:null}

      {!data?.release?<Notice>The owner has not published a paper strategy yet. Your account will remain inactive until a validated release is available.</Notice>:null}

      {account?<p className="table-footnote">Each style has its own allocation and pause control. Selecting a card changes the view. A stock already held by another style is skipped to keep ownership separate.</p>:null}

      <p className="paper-session-note">{account?.marketOpen?'The market is open. Entries depend on the published strategy’s conditions.':account?.nextOpen?`Market closed. Next open: ${new Date(account.nextOpen).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`:'Awaiting broker market status.'}</p>

      {account?.cashPolicy?<div className="algo-cash-summary"><div><span>Available cash for new trades</span><strong>{styleCash?money(styleCash.allocationAvailable):'No allocation yet'}</strong></div><div><span>Sale proceeds awaiting settlement</span><strong>{styleCash?money(styleCash.unsettledProceeds):'No allocation yet'}</strong></div></div>:null}
      {account?.cashPolicy?.ready?<p className="table-footnote">No cooldown after a filled sale. New entries use broker-available cash and must meet the strategy’s conditions.</p>:null}
      {account?.cashPolicy&&!account.cashPolicy.ready?<Notice warning>{account.cashPolicy.reason}</Notice>:null}
      {performance?<AlgoPerformance performance={performance} source="Alpaca Paper"/>:<EmptyState title="No allocation history for this style." description="Your performance chart starts at the virtual amount you authorize for this investing style."/>}
      {account?.equity!==undefined?<p className="table-footnote">Full brokerage equity: {money(account.equity)}. This includes holdings outside your algo allocation.</p>:null}
      <div className="tabs-row"><div className="text-tabs" role="tablist" aria-label="Paper activity"><button role="tab" aria-selected={tab==='fills'} className={tab==='fills'?'active':''} onClick={()=>setTab('fills')}>Executions</button><button role="tab" aria-selected={tab==='closed'} className={tab==='closed'?'active':''} onClick={()=>setTab('closed')}>Closed trades</button><button role="tab" aria-selected={tab==='orders'} className={tab==='orders'?'active':''} onClick={()=>setTab('orders')}>Orders</button></div><span className="environment-tag paper">Alpaca Paper</span></div>

      <div className="section-heading"><h2>{tab==='fills'?'Executed trades':tab==='closed'?'Profit/loss by closed trade':'Order activity'}</h2><span className="small-text">{chosen.title}</span></div>

      {tab!=='orders'?<AlgoExecutions executions={performance?.executions??[]} closedOnly={tab==='closed'} source="Alpaca Paper"/>:orders.length?<div className="paper-order-list">{orders.map(order=><div key={order.id}><strong>{order.symbol}</strong><span>{order.kind==='entry'?'Entry':'Exit'} · {order.filledQuantity}/{order.quantity} filled</span><span className="environment-tag">{order.status}</span></div>)}</div>:<EmptyState title="No orders for this style yet." description="The owner’s published strategy submits orders when its conditions and limits are satisfied."/>}

      <p className="table-footnote">Paper fills are simulated by Alpaca. Managed P&L excludes fees and manual trades. Broker reconciliation can combine partial fills into one observed execution.</p>

    </>}

    {authorize?<Modal title={currentBudget?'Manage '+chosen.title+' allocation':'Start '+chosen.title} onClose={()=>setAuthorize(false)}><Notice>Virtual funds only. This style has its own budget. Other styles keep their allocations.</Notice><div className="form-stack"><label>{currentBudget?'New total allocation (USD)':'Starting allocation (USD)'}<input autoFocus aria-label="Paper allocation amount" type="number" inputMode="decimal" step="0.01" min={Math.max(1,currentBudget)} max={maximum} placeholder="Enter an amount" value={budget} onChange={e=>setBudget(e.target.value)}/></label><p className="small-text">{currentBudget?'Currently '+money(currentBudget)+'. ':''}You can allocate up to {money(maximum)} to this style, based on unallocated broker cash and the combined owner limit. Whole-share orders depend on the strategy’s sizing rules.</p>{currentBudget>0&&validBudget?<Notice>{increase>0?money(increase)+' will be added. Your history and trading profit/loss are preserved.':'Your allocation stays the same. This resumes new entries.'}</Notice>:null}{budget&&!validBudget?<p role="status" className="small-text">Enter an amount from {money(Math.max(1,currentBudget))} to {money(maximum)}, with up to two decimal places. Existing allocations can be increased; pause stops new entries.</p>:null}<label className="checkbox-row"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I authorize {chosen.title} to place automatic stock orders in my Alpaca paper account within this allocation. Other styles may run at the same time.</span></label><Button disabled={!consent||busy||!validBudget} onClick={async()=>{if(await action('authorize',{style,budget:entered,consent}))setAuthorize(false)}}><ShieldCheck size={17}/>{currentBudget&&increase>0?'Confirm increase':currentBudget?'Resume this style':'Activate this style'}</Button></div></Modal>:null}

    {connection?<Modal title="Connect Alpaca Paper" onClose={()=>setConnection(false)}><div className="form-stack"><label>Paper API key<input autoComplete="off" value={key} onChange={e=>setKey(e.target.value)}/></label><label>Paper secret key<input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)}/></label><Button disabled={busy||!key||!secret} onClick={async()=>{if(await action('connect',{key,secret})){setKey('');setSecret('');setConnection(false)}}}>Verify paper connection</Button></div></Modal>:null}



  </>

}

