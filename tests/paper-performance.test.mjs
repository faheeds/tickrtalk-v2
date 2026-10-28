import test from 'node:test'
import assert from 'node:assert/strict'
import {matchExecutions,allocationCash,brokerCash,buildPerformance,groupPerformance} from '../lib/paper/performance.mjs'
const fill=(id,side,qty,price,time,order=id,style='day')=>({id,order_id:order,symbol:'TEST',side,qty,price,time,style,version:'test',source:'test'})
test('partial fills use FIFO purchase cost and group each completed broker order',()=>{
 const fills=[fill('b1','buy',3,57.77,'2026-10-14T14:18:39Z','buy'),fill('b2','buy',4,57.77,'2026-10-14T14:18:40Z','buy'),...([2,3,2].map((qty,i)=>fill('s'+i,'sell',qty,59.28,`2026-10-14T19:55:4${i}Z`,'sell')))]
 const result=matchExecutions(fills);assert.equal(result.realized,10.57);assert.equal(result.executions.length,2);assert.equal(result.executions[0].partialFillCount,3);assert.equal(result.executions[0].qty,7);assert.equal(result.executions[0].entryPrice,57.77)
 assert.equal(buildPerformance({capital:1000,started:'2026-10-14T13:00:00Z',fills,now:'2026-10-14T21:00:00Z'}).value,1010.57)
 assert.throws(()=>matchExecutions([...fills,fills[0]]),/duplicate/)
})
test('unknown sale basis stays unavailable and cannot fund another entry',()=>{
 const fills=[fill('s','sell',1,100,'2026-10-14T14:00:00Z')];assert.equal(matchExecutions(fills).realized,null);assert.throws(()=>allocationCash(1000,fills,[],'2026-10-15T14:00:00Z'),/unmatched/)
 const mixed=[fill('b','buy',1,90,'2026-10-14T13:00:00Z','b','swing'),...fills];assert.equal(matchExecutions(mixed).realized,null)
})
test('confirmed sales restore allocation cash immediately while settlement stays informational',()=>{
 const fills=[fill('b','buy',9,100,'2026-10-09T14:00:00Z'),fill('s','sell',9,101,'2026-10-09T19:00:00Z')],calendar=[{date:'2026-10-09'},{date:'2026-10-13'}]
 assert.deepEqual(allocationCash(1000,fills,calendar,'2026-10-12T16:00:00Z'),{available:1009,unsettled:909});assert.deepEqual(allocationCash(1000,fills,calendar,'2026-10-13T14:00:00Z'),{available:1009,unsettled:0})
 assert.throws(()=>allocationCash(NaN,[],calendar,'2026-10-13T14:00:00Z'))
})
test('cash-only checks use 1x stock buying power and subtract reservations without borrowing',()=>{
 const account={cash:'1000',non_marginable_buying_power:'200',multiplier:'1',short_market_value:'0',buying_power:'1000'};assert.equal(brokerCash(account),1000);assert.equal(brokerCash(account,300),700);assert.equal(brokerCash({...account,buying_power:'150'},300),150)
 assert.throws(()=>brokerCash({...account,multiplier:'2'}),/Borrowing/);assert.throws(()=>brokerCash({...account,buying_power:undefined}),/unavailable/);assert.throws(()=>brokerCash({...account,short_market_value:'-100'}),/short/)
})
test('missing historical open-position marks stay gaps while flat dates reconstruct',()=>{
 const fills=[fill('b','buy',2,100,'2026-01-30T15:00:00Z'),fill('s','sell',2,105,'2026-02-02T15:00:00Z')],performance=buildPerformance({capital:1000,started:'2026-01-30T14:00:00Z',fills,now:'2026-02-03T21:00:00Z'})
 assert.equal(performance.points[0].value,null);assert.equal(performance.points[2].value,null);assert.equal(performance.points[3].value,1010);assert.equal(performance.value,1010)
 for(const grain of ['day','month','quarter','year']){const points=groupPerformance(performance,grain);assert.equal(points[0].value,1000);assert.equal(points.at(-1).value,1010);assert.equal(points.reduce((sum,p)=>sum+(p.realized??0),0),10)}
 assert.equal(groupPerformance(performance,'month')[1].value,null)
})
