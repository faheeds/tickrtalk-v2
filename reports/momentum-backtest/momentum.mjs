// Cross-sectional momentum (12-1), equal weight, monthly rebalance. Research only; the engine has no such style.
//
// Rule, fixed before any result was seen:
//   - On the first session of each month, rank every eligible symbol by its return from 252 sessions ago to
//     21 sessions ago (twelve months, skipping the most recent month), using closes through the previous session.
//   - Hold the top N. Symbols that fall out of the top N are sold at that session's open; the freed cash buys the
//     entrants on the NEXT session's open (sale proceeds settle before they are reused, as a cash account requires).
//     Holdovers are not touched, which keeps turnover low.
//   - Optional market filter: when SPY's previous close is below its 200-session average, hold cash instead of
//     buying entrants, and sell everything at the rebalance. Buying resumes at the next rebalance that passes.
//   - Whole shares, no leverage, no shorting. Each entrant gets (current equity ÷ N), capped by available cash.
//   - Costs: spread 2.5 bps + slippage (5 bps baseline, 15 bps stress) on every fill.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

/** Loads reports/momentum-backtest/data/sp500_ticker_start_end.csv into a predicate (symbol, isoDate) => boolean. */
export function loadMembership(path){
  const intervals=new Map()
  for(const line of readFileSync(path,'utf8').split(/\r?\n/).slice(1)){
    if(!line.trim())continue
    const [ticker,start,end]=line.split(',').map(v=>v.trim())
    const key=ticker.replace('.','-')
    if(!intervals.has(key))intervals.set(key,[])
    intervals.get(key).push([start,end||'9999-12-31'])
  }
  return (symbol,date)=>(intervals.get(symbol.replace('.','-'))??[]).some(([a,b])=>date>=a&&date<=b)
}

const day=d=>d.toISOString().slice(0,10),round=v=>Math.round(v*100)/100
const LOOKBACK=252,SKIP=21,SPY_SMA=200

/** Annualized volatility of daily close-to-close returns over the `window` sessions ending at bar i-1. */
export function trailingVol(bars,i,window=63){
  if(i-window-1<0)return null
  let sum=0,sum2=0,n=0
  for(let k=i-window;k<i;k++){const r=bars[k].close/bars[k-1].close-1;sum+=r;sum2+=r*r;n++}
  const mean=sum/n,variance=sum2/n-mean*mean
  return variance>0?Math.sqrt(variance*252):null
}

export function momentumScores(bars,i,lookback=LOOKBACK,skip=SKIP){
  if(i<lookback)return null
  const recent=bars[i-skip]?.close,old=bars[i-lookback]?.close
  return recent>0&&old>0?recent/old-1:null
}

export function simulateMomentum({data,sessions,spy=null,topN=15,marketFilter=false,capital=25000,slippageBps=5,spreadBps=2.5,eligible=null,lookback=LOOKBACK,skip=SKIP,rebalanceSession=0,rankBy='raw',sectorOf=null,sectorMax=Infinity,volTarget=null,volWindow=63}){
  // Drawdown controls (all off by default):
  //   rankBy 'riskAdjusted': rank by score ÷ trailing annualized volatility instead of raw score.
  //   sectorOf + sectorMax: at most sectorMax names per sector in the top N; lower-ranked names fill the slots.
  //   volTarget: scale total exposure to volTarget ÷ (trailing vol of the equal-weight selected basket), capped at 1.
  //              Entrants are sized at the scaled slot; holdovers are trimmed pro rata when exposure overshoots by >10 points.
  // lookback/skip: the ranking window in sessions (252/21 = 12-1). rebalanceSession: which session of each month
  // triggers the rebalance (0 = first). Both exist for the robustness sweep; the published rule is the default.
  // topN 'all' holds every eligible name equal weight: the universe benchmark, run through the same engine.
  const slip=slippageBps/10000,spread=spreadBps/10000
  const index=Object.fromEntries(Object.entries(data).map(([s,bars])=>[s,new Map(bars.map((b,i)=>[day(b.date),i]))]))
  const spyIndex=spy?new Map(spy.map((b,i)=>[day(b.date),i])):null
  const positions=new Map(),trades=[],curve=[],rebalances=[];let cash=capital,settling=0,pendingBuys=[],peak=capital,maxDrawdown=0,exposureSum=0,turnover=0,equitySum=0,slotCount=topN,exposureFraction=1;const volLog=[]
  const priceAt=(symbol,date,field='close')=>{const i=index[symbol].get(date);return i===undefined?null:data[symbol][i][field]}
  const value=date=>cash+settling+[...positions.values()].reduce((s,p)=>s+p.qty*(priceAt(p.symbol,date)??p.last),0)
  const sell=(p,price,date,reason)=>{const fill=round(price*(1-spread-slip));settling+=p.qty*fill;turnover+=p.qty*fill;positions.delete(p.symbol);trades.push({symbol:p.symbol,qty:p.qty,entry:p.entry,exit:fill,entryDate:p.entryDate,exitDate:date,reason,pnl:round(p.qty*(fill-p.entry)),returnPct:round((fill/p.entry-1)*100)})}
  let lastMonth=null,sessionInMonth=0
  for(const date of sessions){
    cash+=settling;settling=0
    const monthKey=date.slice(0,7);if(monthKey!==lastMonth){lastMonth=monthKey;sessionInMonth=0}else sessionInMonth++
    // Buys queued at the previous rebalance fill at today's open.
    if(pendingBuys.length){
      const equity=value(date),slot=equity*exposureFraction/slotCount
      for(const symbol of pendingBuys){
        const open=priceAt(symbol,date,'open');if(!open||positions.has(symbol))continue
        // The 'all' benchmark uses fractional shares: with ~190 names, $25,000 cannot hold a whole share of each,
        // and the benchmark measures the universe, not a tradable plan.
        const fill=round(open*(1+spread+slip)),qty=topN==='all'?Math.min(slot,cash)/fill:Math.floor(Math.min(slot,cash)/fill)
        if(qty<=0||(topN!=='all'&&qty<1))continue
        cash-=qty*fill;turnover+=qty*fill;positions.set(symbol,{symbol,qty,entry:fill,entryDate:date,last:fill})
      }
      pendingBuys=[]
    }
    if(sessionInMonth===rebalanceSession){
      // Rank on completed bars through the previous session.
      const ranked=[]
      for(const symbol of Object.keys(data)){
        const i=index[symbol].get(date);if(i===undefined)continue
        if(eligible&&!eligible(symbol,date))continue
        const raw=momentumScores(data[symbol],i,lookback,skip);if(raw===null)continue
        let score=raw
        if(rankBy==='riskAdjusted'){const vol=trailingVol(data[symbol],i,126);if(!vol)continue;score=raw/vol}
        ranked.push({symbol,score,raw,i})
      }
      ranked.sort((a,b)=>b.score-a.score||a.symbol.localeCompare(b.symbol))
      slotCount=topN==='all'?Math.max(1,ranked.length):topN
      let chosen=topN==='all'?ranked:ranked.slice(0,topN)
      if(topN!=='all'&&sectorOf&&Number.isFinite(sectorMax)){
        const counts=new Map();chosen=[]
        for(const r of ranked){const sec=sectorOf(r.symbol)??'Unknown',c=counts.get(sec)??0;if(c>=sectorMax)continue;counts.set(sec,c+1);chosen.push(r);if(chosen.length>=topN)break}
      }
      const top=new Set(chosen.map(r=>r.symbol))
      // Exposure fraction from the selected basket's trailing equal-weight volatility.
      exposureFraction=1
      if(volTarget&&chosen.length){
        const rets=[];for(let k=volWindow;k>=1;k--){let sum=0,n=0;for(const r of chosen){const b=data[r.symbol],j=r.i-k;if(j>=1){sum+=b[j].close/b[j-1].close-1;n++}}if(n)rets.push(sum/n)}
        if(rets.length>=20){const mean=rets.reduce((a,b)=>a+b,0)/rets.length,variance=rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length,vol=Math.sqrt(variance*252);if(vol>0)exposureFraction=Math.min(1,volTarget/vol)}
        volLog.push({date,fraction:Math.round(exposureFraction*100)/100})
      }
      let riskOn=true
      if(marketFilter){
        const i=spyIndex?.get(date)
        if(i===undefined||i<SPY_SMA)riskOn=false
        else{let s=0;for(let k=i-SPY_SMA;k<i;k++)s+=spy[k].close;riskOn=spy[i-1].close>s/SPY_SMA}
      }
      let sold=0
      for(const p of [...positions.values()]){
        if(!riskOn||!top.has(p.symbol)){const open=priceAt(p.symbol,date,'open');if(open){sell(p,open,date,riskOn?'dropped_from_top':'market_filter');sold++}}
      }
      if(volTarget&&riskOn&&positions.size){
        const equityNow=value(date),invested=[...positions.values()].reduce((s,p)=>s+p.qty*(priceAt(p.symbol,date,'open')??p.last),0)
        if(invested/equityNow>exposureFraction+0.10){
          const keep=exposureFraction*equityNow/invested
          for(const p of [...positions.values()]){
            const open=priceAt(p.symbol,date,'open');if(!open)continue
            const target=Math.floor(p.qty*keep),cut=p.qty-target;if(cut<1)continue
            const fill=round(open*(1-spread-slip));settling+=cut*fill;turnover+=cut*fill
            trades.push({symbol:p.symbol,qty:cut,entry:p.entry,exit:fill,entryDate:p.entryDate,exitDate:date,reason:'vol_trim',pnl:round(cut*(fill-p.entry)),returnPct:round((fill/p.entry-1)*100)})
            p.qty=target;if(p.qty<1)positions.delete(p.symbol)
          }
        }
      }
      if(riskOn)pendingBuys=[...top].filter(s=>!positions.has(s)).sort()
      rebalances.push({date,eligible:ranked.length,riskOn,sold,queued:pendingBuys.length})
    }
    // Mark positions and record the curve.
    for(const p of positions.values()){const c=priceAt(p.symbol,date);if(c)p.last=c}
    const equity=value(date),invested=equity-cash-settling
    peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak*100);exposureSum+=invested/equity;equitySum+=equity
    curve.push({date,equity:round(equity),cash:round(cash+settling),positions:positions.size})
  }
  const lastDate=sessions.at(-1)
  for(const p of [...positions.values()])sell(p,priceAt(p.symbol,lastDate)??p.last,lastDate,'phase_end')
  cash+=settling;settling=0
  if(curve.length)curve.at(-1).equity=round(cash)
  maxDrawdown=Math.max(maxDrawdown,(peak-cash)/peak*100)
  assert.ok(cash>=-1e-6,'cash went negative')
  assert.ok(Math.abs(capital+trades.reduce((s,t)=>s+t.pnl,0)-cash)<0.05*Math.max(1,trades.length),'ledger does not reconcile')
  const years=sessions.length/252,wins=trades.filter(t=>t.pnl>0),grossWin=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=-trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0)
  return {capital,ending:round(cash),pnl:round(cash-capital),returnPct:round((cash/capital-1)*100),cagrPct:years>0?round((Math.pow(cash/capital,1/years)-1)*100):null,
    maxDrawdownPct:round(maxDrawdown),closedTrades:trades.length,winRatePct:trades.length?round(wins.length/trades.length*100):null,
    profitFactor:grossLoss>0?round(grossWin/grossLoss):(grossWin>0?Infinity:null),averageExposurePct:round(exposureSum/Math.max(1,sessions.length)*100),
    annualTurnoverPct:round(turnover/(equitySum/Math.max(1,sessions.length))/Math.max(years,1e-9)*100/2),rebalances:rebalances.length,monthsInCash:rebalances.filter(r=>!r.riskOn).length,averageExposureFraction:volLog.length?round(volLog.reduce((a,b)=>a+b.fraction,0)/volLog.length):1,trades,curve,rebalanceLog:rebalances,volLog}
}
