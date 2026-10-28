import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PaperStore} from '../services/paper/store.mjs'
import {PaperEngine} from '../services/paper/engine.mjs'
import {createPaperActions} from '../services/paper/actions.mjs'
import {DEFAULT_DRAFT,validateDraft} from '../services/paper/core.mjs'
import {setSp500Snapshot} from '../services/paper/universe.mjs'
import {momentumScore,nextRebalanceSession,rankMomentum,rebalancePlan,trailingVol} from '../services/paper/momentum.mjs'

const fixed=new Date('2026-10-28T14:02:10Z'),key='a'.repeat(64)
const clock={is_open:true,timestamp:fixed.toISOString(),next_open:'2026-10-29T13:30:00Z'}
// Calendar spanning the engine's -30/+14 day window, weekdays only.
const calendar=[];{const d=new Date('2026-09-28T12:00:00Z');for(let k=0;k<45;k++){if(d.getUTCDay()%6)calendar.push({date:d.toISOString().slice(0,10),open:'09:30',close:'16:00'});d.setUTCDate(d.getUTCDate()+1)}}
// Daily bars: 300 completed sessions ending before today, with a steady drift per symbol.
function daily(drift,start=100){const out=[];let p=start;const d=new Date('2025-08-01T04:00:00Z');while(out.length<300){if(d.getUTCDay()%6){p*=1+drift;out.push({t:d.toISOString(),o:+(p*0.999).toFixed(2),h:+(p*1.004).toFixed(2),l:+(p*0.996).toFixed(2),c:+p.toFixed(2),v:1e6})}d.setUTCDate(d.getUTCDate()+1)}return out}
const series={AAA:daily(0.0020),BBB:daily(0.0016,50),CCC:daily(0.0012,20),DDD:daily(0.0008,80),EEE:daily(0.0004,30),FFF:daily(-0.0002,10)}
const members=[{symbol:'AAA',name:'A',sector:'Tech'},{symbol:'BBB',name:'B',sector:'Tech'},{symbol:'CCC',name:'C',sector:'Tech'},{symbol:'DDD',name:'D',sector:'Energy'},{symbol:'EEE',name:'E',sector:'Energy'},{symbol:'FFF',name:'F',sector:'Health'}]

function fixture({positions=[],screening=null}={}){
  const folder=mkdtempSync(join(tmpdir(),'tickrtalk-momentum-')),store=new PaperStore(folder,key)
  const broker={account:async()=>({id:'paper-account-test',status:'ACTIVE',cash:'25000',non_marginable_buying_power:'25000',multiplier:'1',short_market_value:'0',buying_power:'25000',equity:'25000'}),positions:async()=>positions,orders:async()=>[],clock:async()=>clock,calendar:async()=>calendar,
    config:async()=>({no_shorting:true,max_margin_multiplier:'1'}),assets:async()=>members.map(m=>({symbol:m.symbol,tradable:true,status:'active',class:'us_equity'})),asset:async()=>({tradable:true,status:'active',class:'us_equity'}),
    barsMany:async symbols=>Object.fromEntries(symbols.map(s=>[s,series[s]??[]])),bars:async s=>series[s]??[],quote:async()=>({quote:{bp:100,ap:100.1,t:fixed.toISOString()}}),order:async()=>{throw new Error('none')},byClient:async()=>{throw new Error('none')},submit:async()=>{throw new Error('no orders in this test')},cancel:async()=>{}}
  const engine=new PaperEngine(store,{brokerFactory:()=>broker,now:()=>fixed,screeningUrl:screening?'https://screen.example':''})
  if(screening)engine.screen=async symbol=>{const verdict=screening[symbol]??'pass';if(verdict==='pass')return;throw new Error(verdict==='unavailable'?'Required screening is unavailable.':'Screening does not provide a fully verified pass.')}
  store.connect('alice','paper-account-test',{key:'fixture-key',secret:'fixture-secret'})
  store.publish(validateDraft(DEFAULT_DRAFT),'owner');store.authorize('alice','day',25000);store.db.prepare('UPDATE allocations SET started=?').run(fixed.toISOString())
  setSp500Snapshot({name:'S&P 500',source:'test',retrievedAt:fixed.toISOString(),members})
  const {dispatch}=createPaperActions({store,engine,token:'test',scheduleTick:()=>{}})
  return {store,engine,dispatch,close(){engine.close();store.close();rmSync(folder,{recursive:true,force:true})}}
}
const toBars=raw=>raw.map(b=>({date:new Date(b.t),close:b.c}))

test('score, volatility and ranking match the research definitions',()=>{
  const bars=toBars(series.AAA),i=bars.length
  assert.ok(Math.abs(momentumScore(bars,i)-(bars[i-21].close/bars[i-252].close-1))<1e-12)
  assert.equal(momentumScore(bars,200),null)
  assert.ok(trailingVol(bars,i,126)>=0)
  const r=rankMomentum({bars:Object.fromEntries(Object.entries(series).map(([s,v])=>[s,toBars(v)])),topN:3})
  assert.deepEqual(r.selected,['AAA','BBB','CCC']);assert.equal(r.eligible,6);assert.equal(r.ranked[0].rank,1)
  const capped=rankMomentum({bars:Object.fromEntries(Object.entries(series).map(([s,v])=>[s,toBars(v)])),topN:3,sectorOf:s=>members.find(m=>m.symbol===s).sector,sectorMax:2})
  assert.deepEqual(capped.selected,['AAA','BBB','DDD'],'third Tech name should yield to the best Energy name')
  assert.ok(capped.ranked.find(x=>x.symbol==='CCC').sectorCapped)
  assert.throws(()=>rankMomentum({bars:{},topN:0}))
})

test('rebalance plan sells drop-outs, buys entrants at the equal-weight slot and keeps holdovers',()=>{
  const plan=rebalancePlan({selected:['AAA','BBB','CCC'],held:[{symbol:'BBB',qty:4},{symbol:'ZZZ',qty:7}],budget:25000,prices:{AAA:250,BBB:80,CCC:40,ZZZ:12}})
  assert.deepEqual(plan.sells.map(s=>s.symbol),['ZZZ']);assert.deepEqual(plan.keep,['BBB'])
  assert.deepEqual(plan.buys.map(b=>[b.symbol,b.approxQty]),[['AAA',33],['CCC',208]])
  assert.equal(plan.slot,8333.33)
})

test('the next rebalance is the first session of the month, from the calendar',()=>{
  assert.equal(nextRebalanceSession(calendar,'2026-10-28'),'2026-11-02')
  assert.equal(nextRebalanceSession(calendar,'2026-11-02'),'2026-11-02')
  assert.equal(nextRebalanceSession(calendar,'2026-11-03'),'2026-12-01','beyond the window falls back to the first weekday')
})

test('momentum_rank is owner-only, reads bars through the paper broker and reports the plan',async()=>{
  const f=fixture({positions:[{symbol:'DDD',qty:'10'},{symbol:'AAA',qty:'2'}]})
  try{
    await assert.rejects(f.dispatch('alice',false,'momentum_rank',{}),/Owner/)
    const {momentum}=await f.dispatch('alice',true,'momentum_rank',{topN:3,budget:25000})
    assert.deepEqual(momentum.selected,['AAA','BBB','CCC'])
    assert.equal(momentum.nextRebalance,'2026-11-02');assert.equal(momentum.eligible,6);assert.equal(momentum.screeningConfigured,false)
    assert.deepEqual(momentum.plan.sells.map(s=>s.symbol),['DDD']);assert.deepEqual(momentum.plan.keep,['AAA']);assert.deepEqual(momentum.plan.buys.map(b=>b.symbol),['BBB','CCC'])
    assert.equal(momentum.ranked.find(r=>r.symbol==='AAA').screening,'not_configured')
    assert.ok(f.store.audit('alice',true).some(a=>a.action==='momentum_ranked'))
    await assert.rejects(f.dispatch('alice',true,'momentum_rank',{topN:0}),/Top N/)
  }finally{f.close()}
})

test('with screening configured, failures are excluded and the next name in line is promoted',async()=>{
  const f=fixture({screening:{BBB:'fail',EEE:'unavailable'}})
  try{
    const {momentum}=await f.dispatch('alice',true,'momentum_rank',{topN:3})
    assert.deepEqual(momentum.selected,['AAA','CCC','DDD'])
    const row=s=>momentum.ranked.find(r=>r.symbol===s)
    assert.equal(row('BBB').screening,'fail');assert.equal(row('BBB').selected,false);assert.equal(row('DDD').screening,'pass');assert.equal(row('EEE').screening,'unchecked')
  }finally{f.close()}
})
