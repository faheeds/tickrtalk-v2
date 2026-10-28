import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {canReadOwnerResearch} from '../lib/research/owner-access.mjs'
test('owner research requires the authenticated identity to match a configured owner exactly',()=>{
 assert.equal(canReadOwnerResearch('user_owner',' user_owner, user_second '),true)
 for(const user of [null,undefined,'','user_customer','user_owne',' user_owner','user_owner_extra'])assert.equal(canReadOwnerResearch(user,'user_owner'),false)
 assert.equal(canReadOwnerResearch('user_owner',undefined),false)
})
test('owner snapshot contains no execution permission or credentials and cannot invent pending performance',()=>{
 const snapshot=JSON.parse(readFileSync(new URL('../lib/strategies/research-summary.json',import.meta.url),'utf8'))
 assert.equal(snapshot.executionEnabled,false)
 assert.ok(snapshot.catalogCount>=snapshot.eligibleCount)
 assert.ok(!Object.keys(snapshot).some(key=>/secret|credential|token|password|api.?key/i.test(key)))
 if(snapshot.status==='collecting_data'){assert.equal(snapshot.comparisons.length,0);assert.equal(snapshot.selected,null)}
 if(snapshot.status==='research_complete')assert.equal(snapshot.comparisons.length,6)
})
