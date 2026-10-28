import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeAccountRows,moneyInCurrency} from '../lib/workspace/currencies.mjs'
import {matchFills,summarizeHoldings} from '../lib/workspace/finance.mjs'
const position=(currency,price=150)=>({symbol:{symbol:{symbol:'TEST',description:'Test stock',currency:currency?{code:currency}:undefined}},units:2,price,average_purchase_price:100})
const fill=(id,type,currency,price)=>({id,type,currency:{code:currency},symbol:{symbol:'TEST'},units:2,price,trade_date:type==='BUY'?'2026-10-13':'2026-10-14'})

test('Zerodha holdings and fills retain INR amounts without conversion',()=>{
 const native=nativeAccountRows({id:'zerodha'},[position('INR',1250)],[fill('buy','BUY','INR',1000),fill('sell','SELL','INR',1250)])
 assert.equal(native.unknown,0);assert.equal(native.groups.length,1)
 const group=native.groups[0];assert.equal(group.accountId,'zerodha');assert.equal(group.currency,'INR');assert.equal(group.holdings[0].price,1250)
 const trades=matchFills(group.trades.map(t=>({...t,account:group.accountId})));assert.equal(trades[1].pnl,500);assert.equal(trades[1].currency,'INR')
})
test('USD and INR segments never share an account total or FIFO purchase lot',()=>{
 const native=nativeAccountRows({id:'mixed'},[position('USD',15),position('INR',1500)],[])
 assert.equal(native.groups.length,2);assert.equal(native.groups.find(g=>g.currency==='USD').accountId,'mixed');assert.equal(native.groups.find(g=>g.currency==='INR').accountId,'mixed:INR')
 assert.throws(()=>summarizeHoldings(native.groups.flatMap(g=>g.holdings)),/one currency/)
 const rows=matchFills([{account:'same',symbol:'X',currency:'USD',date:'2026-01-01',side:'Buy',quantity:1,price:10},{account:'same',symbol:'X',currency:'INR',date:'2026-01-02',side:'Sell',quantity:1,price:1000}]);assert.equal(rows[1].pnl,null)
})
test('unknown currencies are excluded rather than silently treated as dollars or rupees',()=>{
 const native=nativeAccountRows({id:'unknown'},[position(undefined),position('INR')],[])
 assert.equal(native.unknown,1);assert.equal(native.groups[0].holdings.length,1);assert.equal(native.groups[0].currency,'INR')
})
test('holdings remain available when the provider returns no trade history',()=>{
 const native=nativeAccountRows({id:'zerodha'},[position('INR')],[])
 assert.equal(native.groups[0].holdings.length,1);assert.equal(native.groups[0].trades.length,0)
})
test('money formatting uses rupees and Indian digit grouping independently of USD',()=>{
 assert.equal(moneyInCurrency(1234567.89,false,'INR'),'₹12,34,567.89')
 assert.equal(moneyInCurrency(1234567.89,false,'USD'),'$1,234,567.89')
 assert.equal(moneyInCurrency(-100,true,'INR'),'−₹100.00')
 assert.equal(moneyInCurrency(null,false,'INR'),'Unavailable')
})
