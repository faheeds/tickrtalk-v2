import {randomUUID} from 'node:crypto'
import {paperBroker,BrokerError} from './broker.mjs'
import {clientId,completedBars,entryBody,eastern,evaluate,flattenOrders,freshQuote,isOpen,number,round,session,sizeEntry,strictHalal} from './core.mjs'
import {brokerCash} from '../../lib/paper/performance.mjs'

export function managedPnl(fills,positions) {
  const lots=new Map();let realized=0
  for(const fill of [...fills].sort((a,b)=>a.time.localeCompare(b.time))){
    const queue=lots.get(fill.symbol)??[];lots.set(fill.symbol,queue)
    if(fill.side==='buy')queue.push({qty:fill.qty,price:fill.price})
    else{let remaining=fill.qty;while(remaining>1e-8&&queue.length){const lot=queue[0],qty=Math.min(lot.qty,remaining);realized+=qty*(fill.price-lot.price);lot.qty-=qty;remaining-=qty;if(lot.qty<1e-8)queue.shift()}}
  }
  let unrealized=0
  for(const [symbol,queue]of lots){const p=positions.find(p=>p.symbol===symbol);if(!p)continue;const price=number(p.current_price);unrealized+=queue.reduce((sum,lot)=>sum+lot.qty*(price-lot.price),0)}
  return {realized:round(realized),unrealized:round(unrealized),total:round(realized+unrealized)}
}

export class PaperEngine {
  constructor(store,{brokerFactory=paperBroker,screeningUrl='',now=()=>new Date(),scanLimit=Infinity,scanOffset=0}={}) {this.store=store;this.brokerFactory=brokerFactory;this.screeningUrl=screeningUrl;this.now=now;this.scanLimit=scanLimit;this.scanOffset=scanOffset;this.busy=false;this.streams=new Map();this.lastScan=new Map();this.assetCache=new Map()}
  broker(account){return this.brokerFactory(this.store.decrypt(account.credentials))}
  async connect(user,credentials){
    const broker=this.brokerFactory(credentials),account=await broker.account()
    if(!account?.id || account.status!=='ACTIVE' || account.trading_blocked || account.account_blocked)throw new Error('The Alpaca paper account is not active for trading.')
    const old=this.store.account(user)
    if(old&&old.account_id!==account.id&&(this.store.owned(user).length||this.store.fills(user).length))throw new Error('A different broker account needs a separate history profile. Existing managed history cannot be mixed across accounts.')
    this.store.connect(user,account.id,credentials)
    const previous=this.streams.get(user);if(previous){this.streams.delete(user);previous.close()}
    await this.refresh(this.store.account(user));this.stream(user)
    return account.id
  }
  stream(user){
    if(this.streams.has(user)||this.brokerFactory!==paperBroker)return
    const account=this.store.account(user);if(!account)return
    const credentials=this.store.decrypt(account.credentials),socket=new WebSocket('wss://paper-api.alpaca.markets/stream');this.streams.set(user,socket)
    socket.binaryType='arraybuffer'
    socket.addEventListener('open',()=>socket.send(JSON.stringify({action:'authenticate',data:{key_id:credentials.key,secret_key:credentials.secret}})))
    socket.addEventListener('message',event=>{
      try{
        const messages=JSON.parse(typeof event.data==='string'?event.data:Buffer.from(event.data).toString())
        for(const message of Array.isArray(messages)?messages:[messages]){
          if(message.stream==='authorization' && message.data?.status==='authorized')socket.send(JSON.stringify({action:'listen',data:{streams:['trade_updates']}}))
          if(message.stream==='trade_updates'){
            const order=message.data?.order;if(!order?.id)continue
            for(const intent of this.store.intents(user)){
              if(intent.id===order.client_order_id || intent.broker_id===order.id)this.store.recordOrder(intent.id,order,'Alpaca trade-update stream')
              else if(intent.broker?.legs?.some(leg=>leg.id===order.id))this.store.recordOrder(intent.id,{...intent.broker,legs:intent.broker.legs.map(leg=>leg.id===order.id?order:leg)},'Alpaca trade-update stream')
            }
          }
        }
      }catch{this.store.log(user,'stream_warning','Trade-update parsing failed; REST reconciliation remains active.')}
    })
    socket.addEventListener('error',()=>this.store.log(user,'stream_warning','Trade-update stream unavailable; REST reconciliation remains active.'))
    socket.addEventListener('close',()=>{if(this.streams.get(user)===socket)this.streams.delete(user)})
  }
  close(){for(const socket of this.streams.values())socket.close();this.streams.clear()}
  async reconcile(account,broker){
    for(const intent of this.store.intents(account.user)){
      if(intent.kind==='test'&&['canceled','expired','rejected'].includes(intent.status))continue
      if(!['submitting','unknown'].includes(intent.status) && intent.broker && flattenOrders(intent.broker).every(order=>!isOpen(order)))continue
      try{this.store.recordOrder(intent.id,intent.broker_id?await broker.order(intent.broker_id):await broker.byClient(intent.id))}
      catch(e){if(e.status===404 && intent.status==='unknown')continue;throw e}
    }
  }
  async refresh(account){
    const broker=this.broker(account)
    await this.reconcile(account,broker)
    const [balance,positions,orders,clock,configuration]=await Promise.all([broker.account(),broker.positions(),broker.orders(),broker.clock(),broker.config?broker.config():{no_shorting:true,max_margin_multiplier:'1'}])
    if(balance.id!==account.account_id || !Array.isArray(positions)||!Array.isArray(orders)||orders.length>=500)throw new Error('Account data is incomplete or identity changed.')
    const today=eastern(clock.timestamp).date,start=new Date(new Date(clock.timestamp).getTime()-30*86400000).toISOString().slice(0,10),end=new Date(new Date(clock.timestamp).getTime()+14*86400000).toISOString().slice(0,10),calendar=await broker.calendar(start,end)
    if(!Array.isArray(calendar))throw new Error('Market calendar is unavailable.')
    const market=session(clock,calendar),pnl=managedPnl(this.store.fills(account.user,null),positions)
    let cashPolicy={stocksOnly:true,margin:false,derivatives:false,shortSelling:false,ready:false,reason:null,availableCash:null,allocationAvailable:null,unsettledProceeds:null}
    try{
      const brokerReserved=orders.filter(o=>o.side==='buy').reduce((sum,o)=>{if(!o.limit_price)throw new Error('An open market buy prevents a reliable cash check.');return sum+Math.max(0,number(o.qty)-number(o.filled_qty??0))*number(o.limit_price)},0)
      const availableCash=brokerCash(balance,brokerReserved)
      if(configuration.no_shorting!==true||Number(configuration.max_margin_multiplier)!==1)throw new Error('Broker controls must disable shorting and limit buying power to 1×.')
      const wallets=this.store.styleAccounts(account.user).map(a=>({style:a.style,...this.store.cashAvailable(a,calendar,clock.timestamp)})),wallet=wallets.find(w=>w.style===account.style)
      const managedReserved=this.store.reserved(account.user,account.style)
      cashPolicy={...cashPolicy,ready:true,availableCash,allocationAvailable:wallet?Math.min(availableCash,Math.max(0,wallet.available-managedReserved)):null,unsettledProceeds:wallet?.unsettled??null,styles:Object.fromEntries(wallets.map(w=>[w.style,{allocationAvailable:Math.min(availableCash,Math.max(0,w.available-this.store.reserved(account.user,w.style))),unsettledProceeds:w.unsettled}]))}
    }catch(e){cashPolicy.reason=e.message}
    const snapshot={account:{id:balance.id,status:balance.status,cash:number(balance.cash),buyingPower:number(balance.buying_power),equity:number(balance.equity),blocked:!!balance.trading_blocked||!!balance.account_blocked,cashPolicy},positions,orders,clock,calendar,pnl,observedAt:this.now().toISOString(),nextOpen:clock.next_open}
    this.store.snapshot(account.user,snapshot)
    return {broker,market,snapshot}
  }
  async cancelEmpty(account,broker,expiryMinutes=5){
    for(const intent of this.store.intents(account.user).filter(i=>i.kind==='entry')){
      if(!intent.broker||!isOpen(intent.broker))continue
      const expires=this.now()-new Date(intent.created)>expiryMinutes*60000
      if(!this.store.account(account.user,intent.style).active||this.store.setting().halt||expires){
        await broker.cancel(intent.broker_id)
        this.store.log(account.user,'entry_cancel_requested',`${intent.symbol}: ${account.active?'entry expired':'new entries paused'}`)
      }
    }
  }
  async exit(account,broker,position,reason,market){
    if(!market.open)return
    const priorExits=this.store.intents(account.user).filter(i=>i.symbol===position.symbol&&i.kind==='exit')
    if(priorExits.some(i=>['unknown','submitting'].includes(i.status)||(i.broker&&isOpen(i.broker))))return
    for(const intent of this.store.intents(account.user).filter(i=>i.symbol===position.symbol && i.broker))for(const order of flattenOrders(intent.broker)){
      if(isOpen(order))await broker.cancel(order.id)
    }
    await this.reconcile(account,broker)
    const related=this.store.intents(account.user).filter(i=>i.symbol===position.symbol&&i.broker)
    if(related.some(i=>flattenOrders(i.broker).some(isOpen))){this.store.log(account.user,'exit_waiting','Waiting for confirmed cancellation before closing managed exposure.');return}
    const held=(await broker.positions()).find(p=>p.symbol===position.symbol),owned=this.store.owned(account.user).find(p=>p.symbol===position.symbol)
    if(!held||!owned)return
    const brokerQty=number(held.qty),qty=Math.min(Math.abs(owned.qty),Math.abs(brokerQty))
    if(qty<=0 || Math.sign(owned.qty)!==Math.sign(brokerQty))return
    const side=owned.qty>0?'sell':'buy',id=clientId(account.user,account.account_id,position.symbol,'exit',market.date,related.length)
    const body={symbol:position.symbol,qty:qty.toFixed(6),side,type:'market',time_in_force:'day',extended_hours:false,client_order_id:id}
    await this.submit(account,{id,symbol:position.symbol,style:position.style,version:position.version,kind:'exit',body,reason},broker)
  }
  async submit(account,intent,broker){
    if(!this.store.prepare({...intent,user:account.user}))return false
    if(intent.kind==='entry'){
      const latest=this.store.account(account.user,intent.style)
      if(!latest.active||latest.account_id!==account.account_id||latest.style!==intent.style||latest.budget!==account.budget||latest.consented!==account.consented||this.store.setting().halt||this.store.setting().release_id!==intent.version){this.store.mark(intent.id,'rejected');this.store.log(account.user,'skipped','Authorization or release changed before submission.');return false}
    }
    let attempted=false
    try{
      const asset=await broker.asset(intent.symbol),qty=Number(intent.body.qty)
      if(asset?.class!=='us_equity'||!Number.isFinite(qty)||qty<=0||intent.body.symbol!==intent.symbol||!['buy','sell'].includes(intent.body.side)||!['market','limit'].includes(intent.body.type))throw new BrokerError('Only valid cash-funded stock orders are allowed. Derivatives are prohibited.',422)
      if(intent.kind==='entry'||intent.kind==='test'){
        if(intent.kind==='entry'&&(this.store.owned(account.user).some(p=>p.symbol===intent.symbol&&p.style!==intent.style)||this.store.intents(account.user).some(i=>i.id!==intent.id&&i.symbol===intent.symbol&&i.style!==intent.style&&(['unknown','submitting'].includes(i.status)||(i.broker&&flattenOrders(i.broker).some(isOpen))))))throw new BrokerError('This stock is already managed by another style.',409)
        if(intent.body.side!=='buy'||intent.body.type!=='limit'||!asset.tradable||asset.status!=='active'||(!Number.isFinite(Number(intent.body.limit_price))||Number(intent.body.limit_price)<=0))throw new BrokerError('Entries must be long stock limit orders.',422)
        const balance=await broker.account(),open=await broker.orders(),configuration=broker.config?await broker.config():{no_shorting:true,max_margin_multiplier:'1'}
        if(balance.id!==account.account_id||balance.status!=='ACTIVE'||balance.trading_blocked||balance.account_blocked)throw new BrokerError('Broker identity or trading eligibility changed.',422)
        if(configuration.no_shorting!==true||Number(configuration.max_margin_multiplier)!==1)throw new BrokerError('Broker shorting and margin controls must match the cash-only policy.',422)
        let bankReserved=0
        for(const order of open.filter(o=>o.side==='buy')){if(!order.limit_price)throw new BrokerError('An open market buy prevents a cash check.',422);bankReserved+=Math.max(0,number(order.qty)-number(order.filled_qty??0))*number(order.limit_price)}
        const unresolved=this.store.intents(account.user).filter(i=>i.id!==intent.id&&i.kind==='entry'&&['unknown','submitting'].includes(i.status)&&!open.some(o=>o.client_order_id===i.id||o.id===i.broker_id))
        let available=Math.max(0,brokerCash(balance,bankReserved)-unresolved.reduce((sum,i)=>sum+number(i.body.qty)*number(i.body.limit_price),0))
        if(intent.kind==='entry'){
          const clock=await broker.clock(),calendar=await broker.calendar(new Date(new Date(clock.timestamp)-30*86400000).toISOString().slice(0,10),new Date(new Date(clock.timestamp).getTime()+14*86400000).toISOString().slice(0,10)),wallet=this.store.cashAvailable(account,calendar,clock.timestamp)
          const reserved=this.store.reserved(account.user,intent.style,intent.id)
          available=Math.min(available,Math.max(0,wallet.available-reserved))
        }
        if(!Number.isFinite(available)||qty*Number(intent.body.limit_price)>available+1e-8)throw new BrokerError('The order exceeds available cash. Borrowing is prohibited.',422)
      }else if(intent.kind==='exit'){
        const held=(await broker.positions()).find(p=>p.symbol===intent.symbol),owned=this.store.owned(account.user).find(p=>p.symbol===intent.symbol)
        if(!held||!owned||qty>Math.min(Math.abs(number(held.qty)),Math.abs(owned.qty))+1e-8||(intent.body.side==='sell'&&(number(held.qty)<=0||owned.qty<=0))||(intent.body.side==='buy'&&(number(held.qty)>=0||owned.qty>=0)))throw new BrokerError('An exit can only reduce confirmed managed stock exposure. New short sales are prohibited.',422)
      }else throw new BrokerError('Unknown stock order purpose.',422)
      if(intent.kind==='entry'){
        const latest=this.store.account(account.user,intent.style)
        if(!latest.active||latest.account_id!==account.account_id||latest.style!==intent.style||latest.budget!==account.budget||latest.consented!==account.consented||this.store.setting().halt||this.store.setting().release_id!==intent.version)throw new BrokerError('Authorization changed during the cash check.',409)
      }
      attempted=true
      const order=await broker.submit(intent.body);this.store.recordOrder(intent.id,order);this.store.log(account.user,'order_acknowledged',`${intent.symbol}; ${intent.kind}; ${order.status}; ${intent.id}`)
      if(intent.kind==='entry' && (!this.store.account(account.user,intent.style).active||this.store.setting().halt))await broker.cancel(order.id)
      return true
    }catch(e){
      const definite=!attempted||(e instanceof BrokerError && e.status>=400 && e.status<500 && e.status!==408 && e.status!==429)
      this.store.mark(intent.id,definite?'rejected':'unknown');this.store.log(account.user,definite?'order_rejected':'order_uncertain',e.message)
      if(!definite)this.store.pause(account.user,'An order response is uncertain. Reconcile before resuming new entries.')
      return false
    }
  }
  async screen(symbol){
    if(!this.screeningUrl)throw new Error('Required AAOIFI screening service is not configured.')
    const url=new URL('api/screen?ticker='+encodeURIComponent(symbol),this.screeningUrl.endsWith('/')?this.screeningUrl:this.screeningUrl+'/')
    if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Screening requires HTTPS outside loopback.')
    const response=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});if(!response.ok)throw new Error('Required screening is unavailable.')
    if(!strictHalal(await response.json()))throw new Error('Screening does not provide a fully verified pass.')
  }
  async scan(account,{broker,market,snapshot},release,dry=false){
    const config=release.body,style=account.style,profile=config[style],risk=config.risk
    if(account.budget>risk.maxBudget)throw new Error('Authorization exceeds the current published paper limit. Reauthorize a smaller budget.')
    if(!market.open){this.store.log(account.user,'scan_skipped',`Market closed. Next open: ${snapshot.nextOpen}`);return {signals:[],reason:'Market closed',nextOpen:snapshot.nextOpen}}
    if(Math.abs(this.now()-market.now)>90000)throw new Error('Market clock is stale.')
    if(style==='day'&&(market.minutes<market.openMinute+profile.orbMinutes||market.minutes>=market.closeMinute-risk.flattenMinutes-5))return {signals:[],reason:'Outside the published day-entry window.'}
    const cycle=style==='day'?`${market.date}:${market.minutes}`:style==='swing'?market.date:market.date.slice(0,7)
    if(!dry&&!this.store.reserveCycle(`${account.user}:${release.id}:${style}:${cycle}`,account.user))return {signals:[],reason:'This decision cycle was already evaluated.'}
    const intents=this.store.intents(account.user),allOwned=this.store.owned(account.user),owned=allOwned.filter(p=>p.style===style)
    if(intents.some(i=>['unknown','submitting'].includes(i.status)))throw new Error('Uncertain order state blocks new entries.')
    if(snapshot.account.blocked || snapshot.account.status!=='ACTIVE')throw new Error('Broker account blocks trading.')
    const totalBudget=this.store.authorizations(account.user).reduce((sum,a)=>sum+a.budget,0),accountBaseline=this.store.baseline(account.user,market.date,snapshot.pnl.total)
    if(accountBaseline-snapshot.pnl.total>=totalBudget*risk.dailyLossPct/100){this.store.pause(account.user,'Combined managed loss limit reached.');return {signals:[],reason:'Daily loss guard reached.'}}
    const stylePnl=managedPnl(this.store.fills(account.user,null).filter(f=>f.style===style),snapshot.positions),baseline=this.store.baseline(account.user+':'+style,market.date,stylePnl.total),loss=baseline-stylePnl.total
    if(loss>=account.budget*risk.dailyLossPct/100){this.store.pause(account.user,'Per-session managed loss limit reached.',style);return {signals:[],reason:'Daily loss guard reached.'}}
    for(const p of allOwned){const held=snapshot.positions.find(h=>h.symbol===p.symbol);if(!held||Math.abs(number(held.qty)-p.qty)>1e-6)throw new Error('Managed position ownership changed. Reconciliation is required.')}
    let gross=owned.reduce((sum,p)=>{const held=snapshot.positions.find(h=>h.symbol===p.symbol);return sum+Math.abs(p.qty)*number(held.current_price)},0)
    const pending=intents.filter(i=>i.style===style&&i.kind==='entry'&&(i.status==='unknown'||i.status==='submitting'||(i.broker&&isOpen(i.broker))))
    let reserved=pending.reduce((sum,i)=>sum+Math.max(0,number(i.body.qty)-number(i.broker?.filled_qty??0))*number(i.body.limit_price),0)
    if(!snapshot.account.cashPolicy?.ready)throw new Error(snapshot.account.cashPolicy?.reason??'Settled-cash verification is required.')
    const wallet=this.store.cashAvailable(account,snapshot.calendar,snapshot.clock.timestamp)
    let cash=Math.min(snapshot.account.cashPolicy.availableCash,Math.max(0,wallet.available-reserved))
    let slots=risk.maxPositions-owned.length-pending.filter(i=>number(i.broker?.filled_qty??0)===0).length
    if(slots<=0||cash<=0||account.budget-gross-reserved<=0)return {signals:[],reason:'Published position or capital limits are already allocated.'}
    let assetMap=null
    if(broker.assets){
      let cached=this.assetCache.get(account.account_id)
      if(!cached||this.now().getTime()-cached.time>3600000){
        const assets=await broker.assets();if(!Array.isArray(assets))throw new Error('Broker asset catalog is unavailable.')
        cached={time:this.now().getTime(),values:new Map(assets.map(a=>[a.symbol,a]))};this.assetCache.set(account.account_id,cached)
      }
      assetMap=cached.values
    }
    const candidates=config.universe.filter(symbol=>!snapshot.positions.some(p=>p.symbol===symbol)&&!snapshot.orders.some(o=>o.symbol===symbol)&&(!assetMap||(assetMap.get(symbol)?.tradable&&assetMap.get(symbol)?.status==='active'&&assetMap.get(symbol)?.class==='us_equity')))
    const batch=broker.barsMany?await broker.barsMany(candidates,style==='day',snapshot.clock):null,signals=[]
    for(const symbol of candidates){
      try{
        const bars=completedBars(batch?batch[symbol]??[]:await broker.bars(symbol,style==='day',snapshot.clock),snapshot.clock.timestamp,style==='day')
        const signal=evaluate(style,bars,profile,market);if(!signal||signal.side!=='buy')continue
        if(style==='day'&&market.now-bars.at(-1).date>180000)continue
        if(style!=='day'&&market.now-bars.at(-1).date>6*86400000)continue
        signals.push({symbol,signal})
      }catch(e){this.store.log(account.user,'symbol_skipped',`${symbol}: ${e.message}`)}
    }
    const confirmation=await this.refresh(account)
    const fingerprint=value=>JSON.stringify({cash:value.account.cash,blocked:value.account.blocked,positions:value.positions.map(p=>[p.symbol,p.qty]).sort(),orders:value.orders.map(o=>[o.id,o.status,o.qty,o.filled_qty]).sort()})
    if(fingerprint(snapshot)!==fingerprint(confirmation.snapshot))throw new Error('Broker exposure changed during the universe scan. Wait for the next reconciled cycle.')
    if(!confirmation.market.open||confirmation.market.date!==market.date||Math.abs(this.now()-confirmation.market.now)>90000||(style==='day'&&confirmation.market.minutes>=confirmation.market.closeMinute-risk.flattenMinutes-5))return {signals:[],reason:'Market entry window closed during the universe scan.'}
    signals.sort((a,b)=>(b.signal.score??0)-(a.signal.score??0)||a.symbol.localeCompare(b.symbol))
    const proposals=[]
    for(const {symbol,signal} of signals){
      if(slots<=0)break
      if(snapshot.positions.some(p=>p.symbol===symbol)||snapshot.orders.some(o=>o.symbol===symbol))continue
      try{
        const asset=await broker.asset(symbol);if(!asset.tradable||asset.status!=='active'||asset.class!=='us_equity')throw new Error('Asset is not an active tradable US equity.')
        if(risk.requireHalal)await this.screen(symbol)
        const quote=freshQuote((await broker.quote(symbol)).quote,this.now().toISOString(),risk)
        const sized=sizeEntry({budget:account.budget,remaining:Math.max(0,account.budget-gross-reserved),cash,signal,quote,risk})
        if(!sized){this.store.log(account.user,'signal_skipped',`${symbol}: whole-share sizing or risk limits leave no eligible quantity.`);continue}
        const id=clientId(account.user,account.account_id,release.id,style,symbol,signal.bar,'buy'),body=entryBody(symbol,sized,style,id)
        proposals.push({symbol,...sized,reason:signal.reason,id})
        if(!dry)await this.submit(account,{id,symbol,style,version:release.id,kind:'entry',body,reason:signal.reason},broker)
        reserved+=sized.qty*sized.price;cash-=sized.qty*sized.price;slots--
      }catch(e){this.store.log(account.user,'symbol_skipped',`${symbol}: ${e.message}`)}
    }
    this.store.log(account.user,dry?'dry_run':'scan_completed',`${style}; ${candidates.length}/${config.universe.length} symbols scanned; ${signals.length} qualifying signal(s); ${proposals.length} sized entry candidate(s); ${release.id}`)
    return {signals:proposals,scanned:candidates.length,universeCount:config.universe.length,qualifying:signals.length,reason:proposals.length?'Eligible signals evaluated.':'No qualifying signals. No order was forced.'}
  }
  async tick({user=null,dry=false}={}){
    if(this.busy)return {busy:true}
    this.busy=true;const results=[]
    try{
      this.store.heartbeat();const release=this.store.release()
      for(const account of this.store.accounts().filter(a=>!user||a.user===user)){
        try{
          const context=await this.refresh(account);this.stream(account.user)
          const risk=release?.body.risk
          if(!dry){
            await this.cancelEmpty(account,context.broker,risk?.entryExpiryMinutes??5)
            for(const position of this.store.owned(account.user)){
              const pendingPartial=this.store.intents(account.user).some(i=>i.symbol===position.symbol&&i.kind==='entry'&&i.broker&&number(i.broker.filled_qty??0)>0&&i.broker.status!=='filled')
              const lateDay=position.style==='day'&&context.market.minutes>=context.market.closeMinute-(risk?.flattenMinutes??5)
              if(position.qty<0||pendingPartial||lateDay)await this.exit(account,context.broker,position,lateDay?'Scheduled day-session closeout.':pendingPartial?'Partial entry requires controlled closure.':'Unexpected managed short exposure closure.',context.market)
              if(position.style==='longterm'&&context.market.open){
                const old=this.store.release(position.version),bars=completedBars(await context.broker.bars(position.symbol,false,context.snapshot.clock),context.snapshot.clock.timestamp)
                if(old&&evaluate('longterm',bars,old.body.longterm,context.market)?.side==='sell')await this.exit(account,context.broker,position,'Published long-term trend exit.',context.market)
              }
            }
          }
          if(release&&(dry||(account.active&&!this.store.setting().halt))){
            const authorizations=this.store.styleAccounts(account.user),offset=authorizations.length?this.scanOffset%authorizations.length:0
            let scanned=0
            for(const authorization of [...authorizations.slice(offset),...authorizations.slice(0,offset)]){
              if(scanned>=this.scanLimit)break
              const current=this.store.account(account.user,authorization.style),scanKey=account.user+':'+current.style
              if(!current.active||!release.body[current.style].enabled)continue
              if(!dry&&this.now().getTime()-(this.lastScan.get(scanKey)??0)<60000)continue
              if(current.budget>0){
                scanned++
                this.lastScan.set(scanKey,this.now().getTime())
                try{results.push({user:account.user,style:current.style,...await this.scan(current,await this.refresh(current),release,dry)})}
                catch(error){this.store.log(account.user,'style_scan_error',`${current.style}: ${error.message}`)}
              }
            }
          }
        }catch(e){this.store.snapshot(account.user,account.snapshot??{},e.message);this.store.log(account.user,'worker_error',e.message)}
      }
    }finally{this.busy=false;this.store.heartbeat()}
    return {results}
  }
}
