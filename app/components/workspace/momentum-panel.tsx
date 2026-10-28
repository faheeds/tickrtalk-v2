'use client'
import {useState} from 'react'
import {ArrowsClockwise,ShieldCheck,TrendUp} from '@phosphor-icons/react'
import type {MomentumRanking} from '@/lib/paper/types'
import type {Screening} from '@/lib/workspace/types'
import {Button,Notice,StatusBadge,money} from './primitives'

const screeningLabel:Record<string,string>={pass:'Halal ✓',fail:'Fails screen',unavailable:'Screen unavailable',unchecked:'Not screened',not_configured:'No screening service'}

export function MomentumPanel({connected,budget,busy,action}:{connected:boolean;budget:number;busy:boolean;action:(name:string,input?:Record<string,unknown>)=>Promise<Record<string,unknown>|null|undefined>}){
  const [topN,setTopN]=useState(20),[sectorMax,setSectorMax]=useState<number|null>(null),[rankBy,setRankBy]=useState<'raw'|'riskAdjusted'>('raw'),[amount,setAmount]=useState(budget||25000)
  const [ranking,setRanking]=useState<MomentumRanking|null>(null),[running,setRunning]=useState(false),[message,setMessage]=useState('')
  const [screened,setScreened]=useState<Record<string,Screening>>({}),[screeningBusy,setScreeningBusy]=useState(false),[screeningNote,setScreeningNote]=useState('')
  // Re-select after screening: walk the ranking in order, skip sector-capped names and screening failures.
  const selection=(()=>{
    if(!ranking)return new Set<string>()
    if(!Object.keys(screened).length)return new Set(ranking.selected)
    const chosen:string[]=[],counts=new Map<string,number>()
    for(const r of ranking.ranked){
      if(chosen.length>=ranking.topN)break
      const verdict=screened[r.symbol]?.status
      if(verdict==='fail')continue
      if(ranking.sectorMax){const sec=r.sector??'Unknown',c=counts.get(sec)??0;if(c>=ranking.sectorMax)continue;counts.set(sec,c+1)}
      chosen.push(r.symbol)
    }
    return new Set(chosen)
  })()
  async function screenGroup(){
    if(!ranking)return
    setScreeningBusy(true);setScreeningNote('')
    try{
      const symbols=ranking.ranked.map(r=>r.symbol).slice(0,50)
      const response=await fetch('/api/screening',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols})}),body=await response.json()
      if(!response.ok)throw new Error(body.error??'Screening is unavailable.')
      const next:Record<string,Screening>={};for(const r of body.results as Screening[])next[r.ticker]=r
      setScreened(next)
      const failed=(body.results as Screening[]).filter(r=>r.status==='fail').map(r=>r.ticker),missing=(body.errors??[]).map((e:{ticker:string})=>e.ticker)
      setScreeningNote(`${body.results.length} names screened${failed.length?`; failing: ${failed.join(', ')}`:'; no failures'}${missing.length?`; unavailable: ${missing.join(', ')}`:''}. Results are saved to your Screening page.`)
    }catch(e){setScreeningNote(e instanceof Error?e.message:'Screening is unavailable.')}
    finally{setScreeningBusy(false)}
  }
  async function run(){
    setRunning(true);setMessage('')
    try{const answer=await action('momentum_rank',{topN,sectorMax,rankBy,budget:amount});if(answer&&'momentum' in answer){setRanking(answer.momentum as MomentumRanking);setScreened({});setScreeningNote('')}else if(!answer)setMessage('Ranking did not complete.')}
    finally{setRunning(false)}
  }
  const plan=ranking?.plan
  return <section className="paper-operations momentum-panel" aria-labelledby="momentum-title">
    <div className="lab-heading"><div><div className="eyebrow"><TrendUp size={15}/> MONTHLY MOMENTUM</div><h2 id="momentum-title">12-1 momentum ranking</h2><p>Rank the S&P 500 snapshot by the return from twelve months ago to one month ago, hold the top N equal weight, rebalance on the first session of each month. Research only until a momentum style is published; this never places orders.</p></div></div>
    <div className="paper-fields">
      <label>Top N<select value={topN} onChange={e=>setTopN(Number(e.target.value))}>{[10,15,20,30].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <label>Sector cap<select value={sectorMax??''} onChange={e=>setSectorMax(e.target.value?Number(e.target.value):null)}><option value="">None</option><option value="4">4 per sector</option><option value="5">5 per sector</option></select></label>
      <label>Ranking<select value={rankBy} onChange={e=>setRankBy(e.target.value as 'raw'|'riskAdjusted')}><option value="raw">Raw 12-1 return</option><option value="riskAdjusted">Return ÷ volatility</option></select></label>
      <label>Budget ($)<input type="number" min={1000} step={500} value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label>
    </div>
    <div className="owner-actions"><Button secondary disabled={busy||running||!connected} onClick={run}><ArrowsClockwise size={15}/>{running?'Ranking…':'Compute this month’s ranking'}</Button>{!connected?<span className="small-text">Connect paper credentials first; bars are read through your paper broker.</span>:null}</div>
    {message?<Notice warning>{message}</Notice>:null}
    {ranking?<>
      <div className="paper-owner-status">
        <div><span>Next rebalance</span><strong>{ranking.nextRebalance}</strong></div>
        <div><span>Data through</span><strong>{ranking.dataThrough??'n/a'} · {ranking.eligible} of {ranking.scanned} names ranked</strong></div>
        <div><span>Screening</span><strong>{ranking.screeningConfigured?'AAOIFI service applied to candidates':'Not configured — verify every name before trading'}</strong></div>
      </div>
      {plan?(()=>{
        const heldSet=new Set(ranking.held.map(h=>h.symbol)),chosen=[...selection]
        const sells=ranking.held.filter(h=>!selection.has(h.symbol)),buys=chosen.filter(s=>!heldSet.has(s)),keep=chosen.filter(s=>heldSet.has(s))
        const price=(s:string)=>ranking.ranked.find(r=>r.symbol===s)?.lastClose
        return <div className="paper-owner-status">
          <div><span>Sell at the rebalance open</span><strong>{sells.length?sells.map(s=>`${s.symbol} ×${s.qty}`).join(', '):'Nothing'}</strong></div>
          <div><span>Buy at the next open ({money(plan.slot)} each)</span><strong>{buys.length?buys.map(s=>{const p=price(s);return `${s}${p?` ×${Math.floor(plan.slot/p)}`:''}`}).join(', '):'Nothing'}</strong></div>
          <div><span>Keep</span><strong>{keep.length?keep.join(', '):'Nothing held yet'}</strong></div>
        </div>})():null}
      <div className="lab-table-scroll" role="region" aria-label="Momentum ranking" tabIndex={0}><table>
        <thead><tr><th>#</th><th>Symbol</th><th>Sector</th><th>12-1 return</th><th>Close ~12m ago</th><th>Close ~1m ago</th><th>Last close</th><th>Screening</th><th>Status</th></tr></thead>
        <tbody>{ranking.ranked.map(r=>{const picked=selection.has(r.symbol),verdict=screened[r.symbol];return <tr key={r.symbol} className={picked?'momentum-selected':undefined}>
          <td>{r.rank}</td><td><strong>{r.symbol}</strong></td><td>{r.sector??'—'}</td><td>{r.raw>0?'+':''}{r.raw.toFixed(1)}%{ranking.rankBy==='riskAdjusted'?` (${r.score.toFixed(2)} adj.)`:''}</td>
          <td>{r.oldClose.toFixed(2)} <span className="small-text">{r.oldDate}</span></td><td>{r.recentClose.toFixed(2)} <span className="small-text">{r.recentDate}</span></td><td>{r.lastClose.toFixed(2)}</td>
          <td>{verdict?<span title={`${verdict.verdict}. ${verdict.reason}`}><StatusBadge status={verdict.status}/></span>:screeningLabel[r.screening]??r.screening}</td><td>{picked?'Selected':r.sectorCapped?'Sector cap':(verdict?.status==='fail'||r.screening==='fail')?'Excluded':'Next in line'}</td>
        </tr>})}</tbody>
      </table></div>
      <p className="small-text">Scores use completed daily bars through the previous session on the paper broker’s IEX feed. Share counts use the last close; size on the live price at the open. A name that fails screening is replaced by the next in line.</p>
    </>:null}
  </section>
}
