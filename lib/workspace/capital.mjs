const finite=value=>typeof value==='number'&&Number.isFinite(value)
const day=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString().slice(0,10):null
const internal=new Set(['BUY','SELL','B','S','BOT','SLD','BUY TO OPEN','SELL TO CLOSE','DIVIDEND','SUBSTITUTE_DIVIDEND','REI','STOCK_DIVIDEND','INTEREST','FEE','TAX','SPLIT','OPTIONEXPIRATION','OPTIONASSIGNMENT','OPTIONEXERCISE'])

// Zerodha's connection reports cash as balance.total. Keep this provider-specific
// calculation explicit instead of presenting cash alone as full account value.
export function currentAccountValue(account,positions,balances,currency,singleCurrency,positionsComplete){
 if(account.sync_status?.holdings?.holdings_unavailable||!singleCurrency)return {accountValue:null,accountValueEstimated:false}
 const total=account.balance?.total
 if(!/^zerodha$/i.test(account.institution_name??''))return {accountValue:total?.currency===currency&&finite(total.amount)?total.amount:null,accountValueEstimated:false}
 const cash=balances.find(row=>row.currency?.code===currency)?.cash
 if(!positionsComplete||!finite(cash))return {accountValue:null,accountValueEstimated:false}
 let value=cash
 for(const position of positions){
  const code=position.symbol?.symbol?.currency?.code??position.currency?.code??total?.currency
  if(code!==currency||!finite(position.units)||!finite(position.price))return {accountValue:null,accountValueEstimated:false}
  if(!position.cash_equivalent)value+=position.units*position.price
 }
 return {accountValue:value,accountValueEstimated:true}
}

// A missing or ambiguous transfer valuation must never turn into apparent investment profit.
export function normalizeCapital(history,activities,currency,ledgerComplete){
 const points=new Map()
 if(history?.currency===currency)for(const row of history.history??[]){
  const date=day(row.date),value=row.total_value==null||row.total_value===''?NaN:Number(row.total_value)
  if(date&&Number.isFinite(value))points.set(date,{date,value})
 }
 const ordered=[...points.values()].sort((a,b)=>a.date.localeCompare(b.date))
 let flowsComplete=ledgerComplete&&ordered.length>1
 const flows=[]
 for(const row of activities){
  const date=day(row.trade_date)
  if(date&&ordered.length&&(date<=ordered[0].date||date>ordered.at(-1).date))continue
  const type=String(row.type??'').toUpperCase()
  if(internal.has(type))continue
  if(!date||row.currency?.code!==currency){flowsComplete=false;continue}
  // Generic TRANSFER, security transfers and adjustments lack reliable fair-value semantics.
  if(!['CONTRIBUTION','WITHDRAWAL'].includes(type)||!finite(row.amount)||row.symbol){flowsComplete=false;continue}
  if(type==='CONTRIBUTION'&&row.amount<0||type==='WITHDRAWAL'&&row.amount>0){flowsComplete=false;continue}
  flows.push({date,amount:row.amount})
 }
 return {points:ordered,flows,flowsComplete,estimated:true}
}

// Aggregate only dates actually observed for every selected account. Never invent old balances.
export function capitalOverview(accounts,cutoff){
 if(new Set(accounts.map(a=>a.currency??'USD')).size>1)return {current:null,known:0,selected:accounts.length,points:[],baseline:[],start:null,end:null,netDeposits:null,gain:null,estimated:false,complete:false}
 const selected=accounts.length
 const known=accounts.filter(a=>finite(a.accountValue))
 const current=selected&&known.length===selected?known.reduce((sum,a)=>sum+a.accountValue,0):null
 const maps=accounts.map(a=>new Map((a.capital?.points??[]).filter(p=>p.date>=cutoff&&finite(p.value)).map(p=>[p.date,p.value])))
 const dates=maps.length?[...maps[0].keys()].filter(date=>maps.every(map=>map.has(date))).sort():[]
 const points=dates.map(date=>({date,value:maps.reduce((sum,map)=>sum+map.get(date),0)}))
 const complete=points.length>1&&accounts.every(a=>a.capital?.flowsComplete)
 const start=points[0]?.value??null,end=points.at(-1)?.value??null
 const flows=complete?accounts.flatMap(a=>a.capital.flows).filter(f=>f.date>points[0].date&&f.date<=points.at(-1).date):[]
 let total=0,index=0
 const sorted=[...flows].sort((a,b)=>a.date.localeCompare(b.date))
 const baseline=complete?points.map(point=>{while(index<sorted.length&&sorted[index].date<=point.date)total+=sorted[index++].amount;return start+total}):[]
 const netDeposits=complete?flows.reduce((sum,f)=>sum+f.amount,0):null
 return {current,currentEstimated:accounts.some(a=>a.accountValueEstimated),known:known.length,selected,points,baseline,start,end,netDeposits,gain:complete?end-start-netDeposits:null,estimated:accounts.some(a=>a.capital?.estimated),complete}
}
