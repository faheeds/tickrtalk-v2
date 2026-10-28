import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeCapital,capitalOverview,currentAccountValue} from '../lib/workspace/capital.mjs'
const history={currency:'USD',history:[{date:'2026-01-01',total_value:'1000'},{date:'2026-01-02',total_value:'1550'},{date:'2026-01-03',total_value:'1400'}]}
const activities=[{trade_date:'2026-01-02',type:'CONTRIBUTION',amount:500,currency:{code:'USD'}},{trade_date:'2026-01-03',type:'WITHDRAWAL',amount:-200,currency:{code:'USD'}}]
const account={currency:'USD',accountValue:1400,capital:normalizeCapital(history,activities,'USD',true)}
test('deposits are not gains and withdrawals are not losses',()=>{
 const result=capitalOverview([account],'2026-01-01')
 assert.equal(result.current,1400);assert.equal(result.netDeposits,300);assert.equal(result.gain,100)
 assert.deepEqual(result.baseline,[1000,1500,1300])
})
test('range changes reset the starting balance and exclude opening-day flows',()=>{
 const result=capitalOverview([account],'2026-01-02')
 assert.equal(result.start,1550);assert.equal(result.netDeposits,-200);assert.equal(result.gain,50)
})
test('combined history uses common observed dates only',()=>{
 const second={...account,capital:{...account.capital,points:account.capital.points.slice(1)}}
 const result=capitalOverview([account,second],'2026-01-01')
 assert.deepEqual(result.points.map(p=>p.date),['2026-01-02','2026-01-03'])
 assert.equal(result.start,3100);assert.equal(result.current,2800);assert.equal(result.gain,100)
})
test('a missing selected account balance or history is never silently omitted',()=>{
 const result=capitalOverview([account,{currency:'USD'}],'2026-01-01')
 assert.equal(result.current,null);assert.equal(result.known,1);assert.deepEqual(result.points,[]);assert.equal(result.gain,null)
})
test('zero and negative balances are valid reported values',()=>{
 assert.equal(capitalOverview([{accountValue:0}],'2026-01-01').current,0)
 assert.equal(capitalOverview([{accountValue:-50}],'2026-01-01').current,-50)
})
test('ambiguous transfers, adjustments, unknown types and missing amounts suppress gain estimates',()=>{
 for(const row of [{type:'TRANSFER',amount:500},{type:'ADJUSTMENT',amount:1},{type:'OTHER',amount:5},{type:'CONTRIBUTION',amount:null},{type:'CONTRIBUTION',amount:-50},{type:'WITHDRAWAL',amount:50},{type:'CONTRIBUTION',amount:500,symbol:{symbol:'AAPL'}}]){
  const capital=normalizeCapital(history,[{trade_date:'2026-01-02',currency:{code:'USD'},...row}],'USD',true)
  const result=capitalOverview([{...account,capital}],'2026-01-01')
  assert.equal(result.gain,null);assert.deepEqual(result.baseline,[]);assert.equal(result.points.length,3)
 }
})
test('incomplete activity pagination and unsynced ledgers cannot imply zero contributions',()=>{
 const capital=normalizeCapital(history,activities,'USD',false)
 assert.equal(capitalOverview([{...account,capital}],'2026-01-01').gain,null)
})
test('foreign history and malformed values cannot appear as native-currency value',()=>{
 assert.deepEqual(normalizeCapital({...history,currency:'INR'},activities,'USD',true).points,[])
 const capital=normalizeCapital({currency:'USD',history:[{date:'invalid',total_value:'10'},{date:'2026-01-01',total_value:null},{date:'2026-01-02',total_value:'NaN'}]},[],'USD',true)
 assert.deepEqual(capital.points,[])
})
test('trades, dividends and fees stay in investment result, not external contributions',()=>{
 const capital=normalizeCapital(history,['BUY','SELL','DIVIDEND','FEE','INTEREST'].map(type=>({type,trade_date:'2026-01-02'})),'USD',true)
 assert.equal(capitalOverview([{...account,capital}],'2026-01-01').netDeposits,0)
 assert.equal(capitalOverview([{...account,capital}],'2026-01-01').gain,400)
})
test('no selected accounts is unavailable rather than a fictitious zero portfolio',()=>{
 const result=capitalOverview([],'2026-01-01')
 assert.equal(result.current,null);assert.equal(result.gain,null);assert.deepEqual(result.points,[])
})
test('native currencies can never be added into a combined total',()=>{
 const result=capitalOverview([account,{...account,currency:'INR'}],'2026-01-01')
 assert.equal(result.current,null);assert.deepEqual(result.points,[]);assert.equal(result.gain,null)
})

test('Zerodha cash-only total is reconciled with priced holdings and labeled estimated',()=>{
 const account={institution_name:'Zerodha',balance:{total:{amount:100,currency:'INR'}}}
 const positions=[{units:2,price:500,symbol:{symbol:{currency:{code:'INR'}}}}]
 assert.deepEqual(currentAccountValue(account,positions,[{currency:{code:'INR'},cash:100}],'INR',true,true),{accountValue:1100,accountValueEstimated:true})
 assert.equal(currentAccountValue(account,positions,[],'INR',true,true).accountValue,null)
 assert.equal(currentAccountValue(account,positions,[{currency:{code:'USD'},cash:100}],'INR',true,true).accountValue,null)
 assert.equal(currentAccountValue(account,positions,[{currency:{code:'INR'},cash:100}],'INR',true,false).accountValue,null)
})

test('calculated balance does not double count cash equivalents or silently ignore unpriced holdings',()=>{
 const account={institution_name:'Zerodha',balance:{total:{amount:100,currency:'INR'}}},balances=[{currency:{code:'INR'},cash:100}]
 assert.equal(currentAccountValue(account,[{units:1,price:100,cash_equivalent:true}],balances,'INR',true,true).accountValue,100)
 assert.equal(currentAccountValue(account,[{units:1,price:null}],balances,'INR',true,true).accountValue,null)
 assert.equal(currentAccountValue(account,[],balances,'INR',false,true).accountValue,null)
})

test('other brokers retain their reported equity instead of adding holdings twice',()=>{
 const account={institution_name:'Other broker',balance:{total:{amount:1100,currency:'USD'}}}
 assert.deepEqual(currentAccountValue(account,[{units:2,price:500}],[{currency:{code:'USD'},cash:100}],'USD',true,true),{accountValue:1100,accountValueEstimated:false})
 assert.equal(currentAccountValue(account,[],[],'INR',true,true).accountValue,null)
})
