const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})
const cents=n=>Math.round((n+Number.EPSILON)*100)/100
export const tradingDate=time=>formatter.format(new Date(time))
export function matchExecutions(fills){
  const lots=new Map(),executions=new Map(),daily=new Map(),seen=new Set();let realized=0,unknown=false
  for(const fill of [...fills].sort((a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id))){
    if(!Number.isFinite(fill.qty)||fill.qty<=0||!Number.isFinite(fill.price)||fill.price<=0||!['buy','sell'].includes(fill.side)||!Number.isFinite(new Date(fill.time).getTime()))throw new Error('Execution history contains an invalid fill.')
    if(seen.has(fill.id))throw new Error('Execution history contains a duplicate fill.');seen.add(fill.id)
    const key=`${fill.style}:${fill.symbol}`,queue=lots.get(key)??[];lots.set(key,queue)
    let basis=0,pnl=0,remaining=fill.qty,openedAt=null
    if(fill.side==='buy'){queue.push({qty:fill.qty,price:fill.price,time:fill.time});remaining=0}
    else while(remaining>1e-8&&queue.length){
      const lot=queue[0],qty=Math.min(lot.qty,remaining);basis+=qty*lot.price;pnl+=qty*(fill.price-lot.price);openedAt??=lot.time;lot.qty-=qty;remaining-=qty;if(lot.qty<1e-8)queue.shift()
    }
    if(remaining>1e-8)unknown=true
    realized+=pnl
    const date=tradingDate(fill.time),day=daily.get(date)??{realized:0,unknown:false,bought:0,sold:0}
    day.realized+=pnl;day.unknown||=remaining>1e-8;day[fill.side==='buy'?'bought':'sold']+=fill.qty;daily.set(date,day)
    const id=`${fill.style}:${fill.order_id}`,row=executions.get(id)??{id:fill.order_id,symbol:fill.symbol,style:fill.style,side:fill.side,qty:0,notional:0,basis:0,realizedRaw:0,unknown:false,openedAt:null,time:fill.time,version:fill.version,source:fill.source,partialFillCount:0}
    if(row.side!==fill.side||row.symbol!==fill.symbol)throw new Error('Broker order identity changed in the fill history.')
    row.qty+=fill.qty;row.notional+=fill.qty*fill.price;row.basis+=basis;row.realizedRaw+=pnl;row.unknown||=remaining>1e-8;row.openedAt??=openedAt;row.time=fill.time;row.partialFillCount++;executions.set(id,row)
  }
  const rows=[...executions.values()].map(row=>({...row,price:row.notional/row.qty,entryPrice:row.side==='sell'&&row.basis>0&&!row.unknown?row.basis/row.qty:null,realizedPnl:row.side==='sell'&&!row.unknown?cents(row.realizedRaw):null,returnPct:row.side==='sell'&&row.basis>0&&!row.unknown?row.realizedRaw/row.basis*100:null}))
  return {executions:rows.sort((a,b)=>b.time.localeCompare(a.time)),lots,daily,realized:unknown?null:cents(realized),unknown}
}
export function allocationCash(capital,fills,calendar,now){
  if(!Number.isFinite(capital)||capital<=0||!Array.isArray(calendar)||!Number.isFinite(new Date(now).getTime()))throw new Error('Cash allocation or calendar is invalid.')
  if(matchExecutions(fills).unknown)throw new Error('An unmatched stock sale blocks new entries until its purchase cost is reconciled.')
  const date=tradingDate(now);let spent=0,settled=0,unsettled=0
  for(const fill of fills){
    const notional=fill.qty*fill.price;if(!Number.isFinite(notional)||notional<0)throw new Error('Cash ledger requires valid fills.')
    if(fill.side==='buy')spent+=notional
    else if(fill.side==='sell'){
      const next=calendar.filter(d=>d.date>tradingDate(fill.time)).sort((a,b)=>a.date.localeCompare(b.date))[0]
      if(next&&date>=next.date)settled+=notional;else unsettled+=notional
    }else throw new Error('Cash ledger requires stock buy or sell fills.')
  }
  return {available:cents(Math.max(0,capital-spent+settled+unsettled)),unsettled:cents(unsettled)}
}
export function brokerCash(balance,reserved=0){
  const cash=Number(balance.cash),buyingPower=Number(balance.buying_power),multiplier=Number(balance.multiplier),shorts=Number(balance.short_market_value)
  if(balance.cash==null||balance.buying_power==null||balance.multiplier==null||balance.short_market_value==null||![cash,buyingPower,multiplier,shorts,reserved].every(Number.isFinite)||reserved<0)throw new Error('Broker cash information is unavailable. New entries are blocked.')
  if(multiplier!==1)throw new Error('Cash-only trading requires Alpaca buying power set to 1×. Borrowing is not permitted.')
  if(cash<0||buyingPower<0||Math.abs(shorts)>1e-6)throw new Error('Borrowed cash or short exposure blocks new cash-only entries.')
  return Math.min(Math.max(0,cash-reserved),buyingPower)
}
export function buildPerformance({capital,started,fills,funding=[],observations=[],now=new Date().toISOString()}){
  if(!Number.isFinite(capital)||capital<=0)throw new Error('Performance requires a valid starting allocation.')
  if(funding.some(f=>!Number.isFinite(f.amount)||f.amount<=0||!Number.isFinite(Date.parse(f.time))||f.time<started))throw new Error('Allocation funding history is invalid.')
  funding=funding.filter(f=>f.time<=now)
  const contributed=funding.reduce((sum,f)=>sum+f.amount,0),fundedCapital=cents(capital+contributed)
  const ledger=matchExecutions(fills),start=tradingDate(started),end=tradingDate(now),points=[]
  if(end<start)throw new Error('Performance observation precedes allocation start.')
  const marks=new Map(observations.map(o=>[o.day,o])),ordered=[...fills].sort((a,b)=>a.time.localeCompare(b.time));let pointer=0,openQty=0,cumulative=0,unknown=false
  for(let day=start,count=0;day<=end&&count<3660;day=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10),count++){
    while(pointer<ordered.length&&tradingDate(ordered[pointer].time)<=day){const f=ordered[pointer++];openQty+=f.side==='buy'?f.qty:-f.qty}
    const activity=ledger.daily.get(day);cumulative+=activity?.realized??0;unknown||=activity?.unknown??false
    const added=funding.filter(f=>tradingDate(f.time)<=day).reduce((sum,f)=>sum+f.amount,0)
    const mark=marks.get(day),laterFunding=mark?funding.filter(f=>tradingDate(f.time)===day&&f.time>mark.observedAt).reduce((sum,f)=>sum+f.amount,0):0
    const value=unknown?null:mark&&Number.isFinite(mark.value)?cents(mark.value+laterFunding):Math.abs(openQty)<1e-8?cents(capital+added+cumulative):null
    points.push({date:day,value,funding:cents(funding.filter(f=>tradingDate(f.time)===day).reduce((sum,f)=>sum+f.amount,0)),realized:activity?.unknown?null:cents(activity?.realized??0),coverage:mark?'observed':value===null?'missing':'closed-position reconstruction',observedAt:mark?.observedAt??null})
  }
  const last=points.at(-1)
  return {capital,fundedCapital,contributed:cents(contributed),started,value:last?.value??null,realized:ledger.realized,unrealized:last?.value!=null&&ledger.realized!=null?cents(last.value-fundedCapital-ledger.realized):null,points,executions:ledger.executions,closedTrades:ledger.executions.filter(e=>e.side==='sell'),missingValues:points.filter(p=>p.value===null).length}
}
export function groupPerformance(performance,grain){
  if(!['day','month','quarter','year'].includes(grain))throw new Error('Choose Day, Month, Quarter or Year.')
  const groups=new Map()
  for(const point of performance.points){
    const key=grain==='day'?point.date:grain==='month'?point.date.slice(0,7):grain==='quarter'?`${point.date.slice(0,4)} Q${Math.ceil(Number(point.date.slice(5,7))/3)}`:point.date.slice(0,4)
    const row=groups.get(key)??{key,date:point.date,value:null,realized:0,missing:false,initial:false}
    row.date=point.date;row.value=point.value;if(point.realized===null)row.missing=true;else row.realized+=point.realized;groups.set(key,row)
  }
  return [{key:'Starting allocation',date:tradingDate(performance.started),value:performance.capital,realized:0,initial:true},...[...groups.values()].map(row=>({...row,realized:row.missing?null:cents(row.realized)}))]
}
