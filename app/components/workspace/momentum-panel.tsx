'use client'
import {useState} from 'react'
import {ArrowsClockwise,TrendUp} from '@phosphor-icons/react'
import type {MomentumRanking} from '@/lib/paper/types'
import {Button,Notice,money} from './primitives'

const screeningLabel:Record<string,string>={pass:'Halal ✓',fail:'Fails screen',unavailable:'Screen unavailable',unchecked:'Not screened',not_configured:'No screening service'}

export function MomentumPanel({connected,budget,busy,action}:{connected:boolean;budget:number;busy:boolean;action:(name:string,input?:Record<string,unknown>)=>Promise<Record<string,unknown>|null|undefined>}){
  const [topN,setTopN]=useState(20),[sectorMax,setSectorMax]=useState<number|null>(null),[rankBy,setRankBy]=useState<'raw'|'riskAdjusted'>('raw'),[amount,setAmount]=useState(budget||25000)
  const [ranking,setRanking]=useState<MomentumRanking|null>(null),[running,setRunning]=useState(false),[message,setMessage]=useState('')
  async function run(){
    setRunning(true);setMessage('')
    try{const answer=await action('momentum_rank',{topN,sectorMax,rankBy,budget:amount});if(answer&&'momentum' in answer)setRanking(answer.momentum as MomentumRanking);else if(!answer)setMessage('Ranking did not complete.')}
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
      {plan?<div className="paper-owner-status">
        <div><span>Sell at the rebalance open</span><strong>{plan.sells.length?plan.sells.map(s=>`${s.symbol} ×${s.qty}`).join(', '):'Nothing'}</strong></div>
        <div><span>Buy at the next open ({money(plan.slot)} each)</span><strong>{plan.buys.length?plan.buys.map(b=>`${b.symbol}${b.approxQty!=null?` ×${b.approxQty}`:''}`).join(', '):'Nothing'}</strong></div>
        <div><span>Keep</span><strong>{plan.keep.length?plan.keep.join(', '):'Nothing held yet'}</strong></div>
      </div>:null}
      <div className="lab-table-scroll" role="region" aria-label="Momentum ranking" tabIndex={0}><table>
        <thead><tr><th>#</th><th>Symbol</th><th>Sector</th><th>12-1 return</th><th>Close ~12m ago</th><th>Close ~1m ago</th><th>Last close</th><th>Screening</th><th>Status</th></tr></thead>
        <tbody>{ranking.ranked.map(r=><tr key={r.symbol} className={r.selected?'momentum-selected':undefined}>
          <td>{r.rank}</td><td><strong>{r.symbol}</strong></td><td>{r.sector??'—'}</td><td>{r.raw>0?'+':''}{r.raw.toFixed(1)}%{ranking.rankBy==='riskAdjusted'?` (${r.score.toFixed(2)} adj.)`:''}</td>
          <td>{r.oldClose.toFixed(2)} <span className="small-text">{r.oldDate}</span></td><td>{r.recentClose.toFixed(2)} <span className="small-text">{r.recentDate}</span></td><td>{r.lastClose.toFixed(2)}</td>
          <td>{screeningLabel[r.screening]??r.screening}</td><td>{r.selected?'Selected':r.sectorCapped?'Sector cap':r.screening==='fail'?'Excluded':'Next in line'}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="small-text">Scores use completed daily bars through the previous session on the paper broker’s IEX feed. Share counts use the last close; size on the live price at the open. A name that fails screening is replaced by the next in line.</p>
    </>:null}
  </section>
}
