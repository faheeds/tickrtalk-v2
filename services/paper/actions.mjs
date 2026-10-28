import {createHash,randomUUID} from 'node:crypto'
import {clientId,DEFAULT_DRAFT,flattenOrders,isOpen,validateDraft} from './core.mjs'
import {paperBroker} from './broker.mjs'
import {sp500Snapshot,refreshSp500,resolveUniverse,setSp500Snapshot} from './universe.mjs'
import {MOMENTUM_DEFAULTS,nextRebalanceSession,rankMomentum,rebalancePlan} from './momentum.mjs'
import {completedBars} from './core.mjs'
const invalidAllocation=message=>Object.assign(new Error(message),{status:422})
export function createPaperActions({store,engine,token,localCredentials=()=>({}),scheduleTick=()=>{void engine.tick()}}){
  let localFingerprint='',connecting=false
  if(store.universe?.())setSp500Snapshot(store.universe())
  async function importLocal(user){
    if(user!=='local_owner'||connecting)return
    const credentials=localCredentials();if(!credentials.key||!credentials.secret)return
    const fingerprint=createHash('sha256').update(credentials.key+':'+credentials.secret).digest('hex')
    if(fingerprint===localFingerprint)return
    connecting=true
    try{await engine.connect(user,credentials);localFingerprint=fingerprint}catch(e){store.log(user,'connection_failed',e.message);throw e}finally{connecting=false}
  }
  const ownerActions=new Set(['refresh_sp500','save_draft','validate_draft','publish','halt','unhalt','scan','dry_run','smoke','flatten','momentum_rank'])
  async function dispatch(user,owner,action,input){
    if(ownerActions.has(action)&&!owner)throw Object.assign(new Error('Owner access required.'),{status:403})
    if(action==='status'){
      await importLocal(user)
      const account=store.account(user),release=store.release(),settings=store.setting(),snapshot=account?.snapshot
      const styles=account?store.authorizations(user):[],totalAllocated=styles.reduce((sum,a)=>sum+a.budget,0)
      let unallocatedCash=null
      if(snapshot?.account?.cashPolicy?.ready){try{const assigned=store.styleAccounts(user).reduce((sum,a)=>sum+Math.max(0,store.cashAvailable(a,snapshot.calendar,snapshot.clock.timestamp).available-store.reserved(user,a.style)),0);unallocatedCash=Math.max(0,Math.round((snapshot.account.cashPolicy.availableCash-assigned)*100)/100)}catch{}}
      return {environment:'paper',connected:!!account,performance:store.performance(user),account:account?{id:account.account_id,lastFour:account.account_id.slice(-4),style:account.style,budget:account.budget,active:account.active,consented:account.consented,error:account.error,...(snapshot?{cash:snapshot.account?.cash,equity:snapshot.account?.equity,pnl:snapshot.pnl,cashPolicy:snapshot.account?.cashPolicy,observedAt:snapshot.observedAt,marketOpen:snapshot.clock?.is_open,nextOpen:snapshot.nextOpen}:{})}:null,
        styles,totalAllocated,unallocatedCash,
        release:release?{id:release.id,created:release.created,enabled:{day:release.body.day.enabled,swing:release.body.swing.enabled,longterm:release.body.longterm.enabled},maxBudget:release.body.risk.maxBudget,screeningRequired:release.body.risk.requireHalal}:null,
        worker:{heartbeat:settings.heartbeat,halt:!!settings.halt},fills:store.fills(user),orders:store.intents(user).filter(i=>i.kind!=='test').map(i=>({id:i.id,symbol:i.symbol,style:i.style,version:i.version,kind:i.kind,status:i.status,brokerId:i.broker_id,quantity:Number(i.body.qty),filledQuantity:Number(i.broker?.filled_qty??0),createdAt:i.created,updatedAt:i.updated})),
        ...(owner?{draft:store.draft(),sp500:sp500Snapshot(),releases:store.releases(),audit:store.audit(user,true),accountCount:store.accounts().length,screeningConfigured:!!engine.screeningUrl}:{}),error:account?.error??null}
    }
    if(action==='connect'){
      if(typeof input.key!=='string'||typeof input.secret!=='string'||!input.key.trim()||!input.secret.trim()||input.key.length>200||input.secret.length>200)throw new Error('Paper API key and secret are required.')
      return {accountId:await engine.connect(user,{key:input.key.trim(),secret:input.secret.trim()})}
    }
    if(action==='validate_draft'){
      const draft=validateDraft(store.draft()),account=store.account(user)
      if(!account)throw new Error('Connect paper credentials before broker validation.')
      const context=await engine.refresh(account),assets=[],unavailable=[]
      const catalog=context.broker.assets?await context.broker.assets():null
      if(catalog&&!Array.isArray(catalog))throw new Error('Broker asset catalog is unavailable.')
      const map=catalog?new Map(catalog.map(a=>[a.symbol,a])):null
      for(const symbol of draft.universe){const asset=map?map.get(symbol):await context.broker.asset(symbol);if(!asset?.tradable||asset.status!=='active'||asset.class!=='us_equity'){unavailable.push(symbol);continue}assets.push(symbol)}
      if(!assets.length||(unavailable.length&&draft.universeMode!=='sp500'))throw new Error(`Universe contains unavailable stock symbols: ${unavailable.join(', ')}.`)
      const result={hash:createHash('sha256').update(JSON.stringify(draft)).digest('hex'),assets,unavailable,universeMode:draft.universeMode,universeCount:draft.universe.length,marketOpen:context.market.open,nextOpen:context.snapshot.nextOpen,validatedAt:new Date().toISOString(),note:'Configuration and asset eligibility checked. This does not establish strategy profitability.'}
      store.log(user,'draft_validated',JSON.stringify({...result,assets:undefined,assetCount:assets.length,unavailable:unavailable.slice(0,20),unavailableCount:unavailable.length}));return {validation:result}
    }
    if(action==='momentum_rank'){
      // Owner preview of the monthly 12-1 momentum rebalance. Reads bars and positions through the owner's paper
      // broker, ranks the current S&P 500 snapshot, screens the candidates when AAOIFI is configured, and reports
      // what a rebalance would sell and buy. Nothing is ordered here.
      const account=store.account(user);if(!account)throw new Error('Connect paper credentials before ranking.')
      const topN=Number.isInteger(input.topN)?input.topN:MOMENTUM_DEFAULTS.topN
      const sectorMax=input.sectorMax==null?null:Number(input.sectorMax)
      const rankBy=input.rankBy==='riskAdjusted'?'riskAdjusted':'raw'
      if(topN<1||topN>50)throw invalidAllocation('Top N must be between 1 and 50.')
      if(sectorMax!==null&&(!Number.isInteger(sectorMax)||sectorMax<1||sectorMax>topN))throw invalidAllocation('Sector cap must be a whole number no larger than top N.')
      const snapshot=sp500Snapshot();if(!snapshot)throw new Error('Refresh the S&P 500 constituent snapshot first.')
      const members=snapshot.members,sectorOf=Object.fromEntries(members.map(m=>[m.symbol,m.sector]))
      const context=await engine.refresh(account),{broker,snapshot:state}=context
      const budget=Number.isFinite(input.budget)&&input.budget>0?Number(input.budget):account.budget
      let assetMap=null
      if(broker.assets){const assets=await broker.assets();if(Array.isArray(assets))assetMap=new Map(assets.map(a=>[a.symbol,a]))}
      const symbols=members.map(m=>m.symbol).filter(s=>!assetMap||(assetMap.get(s)?.tradable&&assetMap.get(s)?.status==='active'&&assetMap.get(s)?.class==='us_equity'))
      const raw=broker.barsMany?await broker.barsMany(symbols,false,state.clock):Object.fromEntries(await Promise.all(symbols.map(async s=>[s,await broker.bars(s,false,state.clock)])))
      const bars={};for(const s of symbols)bars[s]=completedBars(raw[s]??[],state.clock.timestamp,false)
      const ranking=rankMomentum({bars,topN,sectorOf:s=>sectorOf[s]??null,sectorMax,rankBy})
      // Screening: walk the ranking in order until topN names pass, checking at most topN+15 candidates.
      const screening={},selected=[]
      if(engine.screeningUrl){
        let checked=0
        for(const r of ranking.ranked){
          if(selected.length>=topN||checked>=topN+15)break
          if(sectorMax&&r.sectorCapped)continue
          if(sectorMax){const used=selected.filter(s=>(sectorOf[s]??'Unknown')===(r.sector??'Unknown')).length;if(used>=sectorMax)continue}
          checked++
          try{await engine.screen(r.symbol);screening[r.symbol]='pass';selected.push(r.symbol)}catch(e){screening[r.symbol]=e.message.includes('unavailable')||e.message.includes('not configured')?'unavailable':'fail'}
        }
      }else selected.push(...ranking.selected)
      const held=state.positions.map(p=>({symbol:p.symbol,qty:Number(p.qty),style:store.owned(user).find(o=>o.symbol===p.symbol)?.style??null}))
      const prices=Object.fromEntries(ranking.ranked.map(r=>[r.symbol,r.lastClose]))
      const plan=rebalancePlan({selected,held,budget,prices,topN})
      const today=state.calendar.find(d=>d.date>=state.clock.timestamp.slice(0,10))?.date??state.clock.timestamp.slice(0,10)
      const result={asOf:state.clock.timestamp,dataThrough:ranking.ranked[0]?.lastDate??null,nextRebalance:nextRebalanceSession(state.calendar,today),topN,sectorMax,rankBy,budget,eligible:ranking.eligible,scanned:symbols.length,skipped:ranking.skipped.length,screeningConfigured:!!engine.screeningUrl,
        ranked:ranking.ranked.slice(0,topN+15).map(r=>({rank:r.rank,symbol:r.symbol,sector:r.sector,score:Math.round(r.score*10000)/100,raw:Math.round(r.raw*10000)/100,lastClose:r.lastClose,recentClose:r.recentClose,recentDate:r.recentDate,oldClose:r.oldClose,oldDate:r.oldDate,selected:selected.includes(r.symbol),sectorCapped:!!r.sectorCapped,screening:screening[r.symbol]??(engine.screeningUrl?'unchecked':'not_configured')})),
        selected,plan,held}
      store.log(user,'momentum_ranked',JSON.stringify({topN,sectorMax,rankBy,budget,eligible:ranking.eligible,selected,sells:plan.sells.map(s=>s.symbol),buys:plan.buys.map(b=>b.symbol),nextRebalance:result.nextRebalance}))
      return {momentum:result}
    }
    if(action==='refresh_sp500'){const snapshot=await refreshSp500();store.saveUniverse(snapshot);store.log(user,'universe_refreshed',`S&P 500 source refreshed: ${snapshot.members.length} symbols. Save, validate and publish to change the active release.`);return {refreshed:true,count:snapshot.members.length}}
    if(action==='save_draft'){const draft=validateDraft(resolveUniverse(input.draft));store.saveDraft(draft,user);return {saved:true,draft}}
    if(action==='publish'){
      const draft=validateDraft(store.draft())
      if(draft.universeMode==='sp500'&&Date.now()-new Date(draft.universeAsOf).getTime()>7*86400000)throw new Error('Refresh and save the S&P 500 draft before publishing.')
      if(draft.risk.requireHalal&&!engine.screeningUrl)throw new Error('Connect AAOIFI screening before publishing a screening-required strategy.')
      const hash=createHash('sha256').update(JSON.stringify(draft)).digest('hex')
      const validation=store.audit(user,true).find(item=>{if(item.action!=='draft_validated')return false;try{return JSON.parse(item.detail).hash===hash}catch{return false}})
      if(!validation||Date.now()-new Date(validation.time)>86400000)throw new Error('Validate this draft against the paper broker before publishing.')
      if(input.paperOnly!==true)throw new Error('Paper release acknowledgment is required.')
      return {version:store.publish(draft,user)}
    }
    const account=store.account(user)
    if(action==='halt'){store.halt(true);for(const a of store.accounts())store.pause(a.user,'Owner emergency halt. Protective exits continue.');store.log(user,'emergency_halt','All new paper entries halted.');scheduleTick();return {halted:true}}
    if(action==='unhalt'){store.halt(false);store.log(user,'halt_cleared','Owner cleared global halt; customers must reauthorize.');return {halted:false}}
    if(!account)throw Object.assign(new Error('Connect an Alpaca paper account first.'),{status:428})
    if(action==='authorize'){
      const release=store.release(),budget=Number(input.budget),style=input.style
      if(!release||store.setting().halt||!['day','swing','longterm'].includes(style)||!release.body[style].enabled)throw invalidAllocation('This paper strategy is unavailable.')
      if(!Number.isFinite(budget)||budget<1||Math.abs(Math.round(budget*100)-budget*100)>1e-6||budget>release.body.risk.maxBudget||input.consent!==true)throw invalidAllocation('Enter a paper allocation of at least $1, with up to two decimal places, within the owner limit.')
      const previous=store.account(user,style),increase=budget-previous.budget,totalAllocated=store.authorizations(user).reduce((sum,a)=>sum+a.budget,0)
      if(increase<0)throw invalidAllocation('Enter the current allocation or a higher amount. Pause this style to stop new entries.')
      if(totalAllocated+increase>release.body.risk.maxBudget)throw invalidAllocation('The combined allocations exceed the owner’s published paper limit.')
      if(store.intents(user).some(i=>i.kind!=='test'&&['unknown','submitting'].includes(i.status)))throw invalidAllocation('Resolve uncertain orders before changing an allocation.')
      const context=await engine.refresh(account)
      if(!context.snapshot.account.cashPolicy?.ready)throw invalidAllocation(context.snapshot.account.cashPolicy?.reason??'Cash-only verification is required.')
      if(context.snapshot.account.blocked||context.snapshot.account.status!=='ACTIVE')throw invalidAllocation('Alpaca paper account blocks trading.')
      const assigned=store.styleAccounts(user).reduce((sum,a)=>sum+Math.max(0,store.cashAvailable(a,context.snapshot.calendar,context.snapshot.clock.timestamp).available-store.reserved(user,a.style)),0)
      if(increase>Math.max(0,context.snapshot.account.cashPolicy.availableCash-assigned)+1e-8)throw invalidAllocation('This increase exceeds unallocated broker cash. Funds assigned to another style cannot be used twice.')
      store.authorize(user,style,budget);await engine.refresh(store.account(user,style));scheduleTick();return {authorized:true,style,budget,environment:'paper'}
    }
    if(action==='pause'){if(!['day','swing','longterm'].includes(input.style))throw new Error('Choose the style to pause.');store.pause(user,'Customer paused new entries.',input.style);scheduleTick();return {paused:true,style:input.style,detail:'This style’s new entries are paused. Pending entries are being cancelled; protective monitoring continues.'}}
    if(action==='scan'||action==='dry_run')return engine.tick({user,dry:action==='dry_run'})
    if(action==='flatten'){
      if(input.confirm!==true)throw new Error('Confirm closing only the managed paper exposure.')
      store.pause(user,'Owner requested managed paper exposure closure.');const context=await engine.refresh(account)
      if(!context.market.open)throw new Error('The market is closed. Entries are paused; controlled closure will need an open session.')
      for(const position of store.owned(user))await engine.exit(store.account(user),context.broker,position,'Owner requested paper closeout.',context.market)
      return {closeRequested:true}
    }
    if(action==='smoke'){
      if(input.confirm!==true)throw new Error('Confirm the unmarketable paper connection check.')
      const broker=engine.broker(account),asset=await broker.asset('AAPL')
      if(!asset.tradable)throw new Error('The connection-check asset is unavailable.')
      const id=clientId(user,'connection-check',randomUUID()),body={symbol:'AAPL',qty:'1',side:'buy',type:'limit',limit_price:'0.01',time_in_force:'day',extended_hours:false,client_order_id:id}
      const intent={id,user,symbol:'AAPL',style:account.style,version:'connection-check',kind:'test',body,reason:'Unmarketable paper connectivity check; cancel immediately.'}
      if(!await engine.submit(account,intent,broker))throw new Error('Connection-check submission was not acknowledged. Inspect the owner audit.')
      const known=store.intent(id);await broker.cancel(known.broker_id)
      for(let attempt=0;attempt<8;attempt++){
        const order=await broker.order(known.broker_id);store.recordOrder(id,order)
        if(order.status==='canceled'){store.log(user,'connection_check','Paper order acknowledged and cancellation confirmed.');return {passed:true,orderId:order.id,status:order.status}}
        if(Number(order.filled_qty)>0)throw new Error('Unexpected fill in the paper connection check. Inspect this paper order.')
        await new Promise(resolve=>setTimeout(resolve,500))
      }
      throw new Error('Cancellation is not yet confirmed. Reconcile the paper connection-check order before continuing.')
    }
    throw Object.assign(new Error('Unknown paper action.'),{status:400})
  }
  return {dispatch,importLocal}
}
