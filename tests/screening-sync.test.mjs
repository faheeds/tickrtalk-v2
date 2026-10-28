import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {mergeScreenings} from '../lib/workspace/screening-state.mjs'

const report=(status,asOf)=>({ticker:'AAPL',status,asOf,verdict:'Test assessment',reason:'Test evidence',ratios:[]})
test('saved assessments survive browser-state replacement without letting an older response overwrite a newer screen',()=>{
 const older=report('review','2026-10-14T00:00:00Z'),newer=report('pass','2026-10-15T00:00:00Z')
 assert.deepEqual(mergeScreenings({}, {AAPL:older}),{AAPL:older})
 assert.deepEqual(mergeScreenings({AAPL:newer},{AAPL:older}),{AAPL:newer})
 assert.deepEqual(mergeScreenings({AAPL:older},{AAPL:newer}),{AAPL:newer})
 assert.deepEqual(mergeScreenings({AAPL:newer},{AAPL:{...older,status:'unexpected'}}),{AAPL:newer})
 assert.deepEqual(mergeScreenings({AAPL:newer},{AAPL:{...older,ticker:'MSFT'}}),{AAPL:newer})
})

test('screening storage separates users, preserves newest reports and denies direct customer access',async()=>{
 const db=new PGlite()
 try{
  await db.exec("create role anon; create role authenticated; create role service_role; create table public.users(id text primary key); insert into public.users values('user_one'),('user_two');")
  await db.exec(readFileSync('supabase/migrations/20261015_screening_assessments.sql','utf8'))
  const save=(user,assessment)=>db.query('select public.save_screening_assessments($1,$2)',[user,JSON.stringify([assessment])])
  await save('user_one',report('pass','2026-10-15T00:00:00Z'))
  await save('user_two',report('fail','2026-10-14T00:00:00Z'))
  await save('user_one',report('review','2026-10-13T00:00:00Z'))
  assert.deepEqual((await db.query("select user_id,report->>'status' as status from public.screening_assessments order by user_id")).rows,[{user_id:'user_one',status:'pass'},{user_id:'user_two',status:'fail'}])
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role)
   await assert.rejects(()=>db.query('select report from public.screening_assessments'),/permission denied/)
   await assert.rejects(()=>save('user_one',report('fail','2026-10-16T00:00:00Z')),/permission denied/)
   await db.exec('reset role')
  }
 }finally{await db.close()}
})
