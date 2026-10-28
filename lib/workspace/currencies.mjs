const code=value=>typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null
export function nativeAccountRows(account,positions,activities){
 const base=code(account.currency?.code)??code(account.balance?.currency?.code)
 const positionCurrency=p=>code(p.symbol?.symbol?.currency?.code)??code(p.currency?.code)
 const activityCurrency=f=>code(f.currency?.code)
 const observed=[...new Set([...positions.map(positionCurrency),...activities.map(activityCurrency)].filter(Boolean))]
 const fallback=base&&observed.every(currency=>currency===base)?base:null
 const currencies=[...new Set([...observed,...(base?[base]:[])])].sort()
 const groups=new Map(currencies.map(currency=>[currency,{currency,holdings:[],trades:[],skipped:0}]))
 let unknown=0
 const ensure=currency=>{if(!groups.has(currency))groups.set(currency,{currency,holdings:[],trades:[],skipped:0});return groups.get(currency)}
 for(const position of positions){
  const currency=positionCurrency(position)??fallback
  if(!currency){unknown++;continue}
  const group=ensure(currency),symbol=position.symbol?.symbol?.symbol
  if(!symbol||position.units==null||position.price==null)continue
  group.holdings.push({symbol,name:position.symbol.symbol.description??symbol,quantity:position.units,cost:position.average_purchase_price??null,price:position.price,color:'#b3c9d7',screening:'unavailable',currency})
 }
 for(const fill of activities){
  if(!['BUY','SELL','B','S','BOT','SLD','BUY TO OPEN','SELL TO CLOSE'].includes(fill.type?.toUpperCase())||!fill.symbol?.symbol||fill.units==null||fill.price==null)continue
  const currency=activityCurrency(fill)??fallback
  if(!currency){unknown++;continue}
  ensure(currency).trades.push({id:fill.id,symbol:fill.symbol.symbol,name:fill.symbol.description??fill.symbol.symbol,date:fill.trade_date,side:['BUY','B','BOT','BUY TO OPEN'].includes(fill.type.toUpperCase())?'Buy':'Sell',quantity:Math.abs(fill.units),price:fill.price,pnl:null,style:'swing',mode:'real',status:'Filled',origin:'manual',currency})
 }
 return {unknown,groups:[...groups.values()].map(group=>({...group,accountId:groups.size===1||group.currency==='USD'?account.id:account.id+':'+group.currency}))}
}

export function moneyInCurrency(value,signed=false,currency='USD'){
 if(value==null||!Number.isFinite(value))return 'Unavailable'
 return `${signed&&value>0?'+':value<0?'−':''}${new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{style:'currency',currency,maximumFractionDigits:2}).format(Math.abs(value))}`
}
