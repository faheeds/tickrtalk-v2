'use client'
import {useMemo,useState} from 'react'
import {CheckCircle,Circle,Pause,Play} from '@phosphor-icons/react'
import type {WorkspaceProps} from './workspace-app'
import {Button,EmptyState,PageHeader} from './primitives'
import {PaperAlgoView} from './paper-algo'
import {AlgoPerformance,AlgoExecutions,StockOnlyPolicy} from './algo-performance'
import {samplePerformance} from '@/lib/paper/sample-performance'
const styles=[{key:'day',title:'Day Trading',duration:'Within the trading day'},{key:'swing',title:'Swing Trading',duration:'Days to weeks'},{key:'longterm',title:'Medium / Long-Term Investing',duration:'Months or longer'}]
export function AlgoView(props:WorkspaceProps){
 const [sample,setSample]=useState(false)
 if(props.demo&&!props.localServices)return <SampleAlgoView {...props}/>
 return <>{props.demo?<div className="research-mode" role="group" aria-label="Algo data source"><button aria-pressed={!sample} onClick={()=>setSample(false)}>Alpaca paper account</button><button aria-pressed={sample} onClick={()=>setSample(true)}>Sample walkthrough</button></div>:null}{sample&&props.demo?<SampleAlgoView {...props}/>:<PaperAlgoView {...props}/>}</>
}
function SampleAlgoView({toast}:WorkspaceProps){
 const [style,setStyle]=useState('day'),[mode,setMode]=useState('paper'),[paused,setPaused]=useState(false),[tab,setTab]=useState('executions')
 const performance=useMemo(()=>samplePerformance(style,1000),[style])
 return <>
  <PageHeader title="Automated investing, at your pace." mobileTitle="Algo Trading" description="Choose your style. See how your allocation and each trade performed."/>
  <div className="algo-intro-row"><span className="eyebrow">YOUR INVESTING STYLE</span><div className="mode-switch" role="group" aria-label="Trading environment"><button aria-pressed={mode==='paper'} className={mode==='paper'?'active':''} onClick={()=>setMode('paper')}>Paper Trading <span>Simulated</span></button><button aria-pressed={mode==='real'} className={mode==='real'?'active real-active':''} onClick={()=>setMode('real')}>Real Trading</button></div></div>
  <div className="style-options" role="radiogroup" aria-label="Investing style">{styles.map((item,index)=><button key={item.key} role="radio" aria-checked={style===item.key} tabIndex={style===item.key?0:-1} className={`style-option ${style===item.key?'selected':''}`} onClick={()=>setStyle(item.key)} onKeyDown={e=>{if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();const next=(index+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+styles.length)%styles.length;setStyle(styles[next].key);(e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus()}}}><div className="style-option-title">{style===item.key?<CheckCircle size={23} weight="fill"/>:<Circle size={23}/>}<strong>{item.title}</strong></div><span>{item.duration}</span></button>)}</div>
  <StockOnlyPolicy/>
  {mode==='real'?<EmptyState title="Real Trading is not released yet." description="This preview cannot submit orders. The trading policy permits only cash-funded stocks, without borrowing or derivatives."/>:<>
   <section className="automation-status"><div><strong>Paper example · $1,000 virtual allocation</strong><p className="small-text">Illustrative history. This is separate from your connected paper account.</p><span className="running-status"><span/><strong>{paused?'Sample paused':'Sample running'}</strong></span></div><Button secondary onClick={()=>{setPaused(!paused);toast('Sample state changed. Your connected paper account is unaffected.')}}>{paused?<Play size={16}/>:<Pause size={16}/>} {paused?'Resume sample':'Pause sample'}</Button></section>
   <AlgoPerformance performance={performance} source="Sample data"/>
   <div className="tabs-row"><div className="text-tabs" role="tablist" aria-label="Sample activity"><button role="tab" aria-selected={tab==='executions'} className={tab==='executions'?'active':''} onClick={()=>setTab('executions')}>Executions</button><button role="tab" aria-selected={tab==='closed'} className={tab==='closed'?'active':''} onClick={()=>setTab('closed')}>Closed trades</button></div><span className="environment-tag paper">Sample · Paper</span></div>
   <div className="section-heading"><h2>{tab==='closed'?'Profit/loss by closed trade':'Executed trades'}</h2></div><AlgoExecutions executions={performance.executions} closedOnly={tab==='closed'} source="Sample data"/>
  </>}
 </>
}
