import test from 'node:test'
import assert from 'node:assert/strict'
import { chunkSymbols, filledTransactions, matchFills, screeningCounts, summarizeHoldings, unrealized } from '../lib/workspace/finance.mjs'
test('unknown basis stays unavailable and is excluded from P&L', () => {
 const positions=[{quantity:10,price:12,cost:10},{quantity:20,price:15,cost:null}]
 assert.equal(unrealized(positions[1]),null)
 assert.deepEqual(summarizeHoldings(positions),{value:420,unrealized:20,incomplete:true})
})
test('FIFO lots cannot cross accounts and partially missing basis stays unavailable', () => {
 const rows=matchFills([{account:'a',symbol:'X',date:'2026-01-01',side:'Buy',quantity:10,price:10},{account:'b',symbol:'X',date:'2026-01-02',side:'Sell',quantity:5,price:15},{account:'a',symbol:'X',date:'2026-01-03',side:'Sell',quantity:12,price:15}])
 assert.equal(rows[1].pnl,null)
 assert.equal(rows[2].pnl,null)
 assert.equal(rows[2].basisIncomplete,true)
})
test('FIFO computes a fully matched sale across purchase lots', () => {
 const rows=matchFills([{account:'a',symbol:'X',date:'2026-01-01',side:'Buy',quantity:3,price:10},{account:'a',symbol:'X',date:'2026-01-02',side:'Buy',quantity:2,price:20},{account:'a',symbol:'X',date:'2026-01-03',side:'Sell',quantity:4,price:25}])
 assert.equal(rows[2].pnl,50)
})
test('screening counts preserve unknown results instead of assigning a verdict', () => {
 assert.deepEqual(screeningCounts([{symbol:'A'},{symbol:'B'},{symbol:'C'}],{A:{status:'pass'},B:{status:'review'}}),{pass:1,review:1,fail:0,unavailable:1})
})
test('executed activity isolates the environment, style, and actual fills', () => {
 const base={origin:'algo',style:'swing',mode:'paper',status:'Filled'}
 const records=[{...base,id:1},{...base,id:2,mode:'real'},{...base,id:3,status:'Rejected'},{...base,id:4,origin:'manual'},{...base,id:5,style:'day'}]
 assert.deepEqual(filledTransactions(records,'paper','swing').map(t=>t.id),[1])
})
test('large portfolios are deduplicated and chunked at the service limit', () => {
 const symbols=Array.from({length:121},(_,i)=>`S${i}`)
 const chunks=chunkSymbols([...symbols,'s0',' S0 '])
 assert.deepEqual(chunks.map(c=>c.length),[50,50,21])
 assert.equal(chunks.flat().length,121)
})
