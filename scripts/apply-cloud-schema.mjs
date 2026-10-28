import {readFileSync} from 'node:fs'
import dotenv from 'dotenv'
const env=dotenv.parse(readFileSync('.env.hosted'))
const source=readFileSync('supabase/migrations/20261015_cloud_workers.sql','utf8')
if(!process.argv.includes('--apply')){console.log('Cloud migration is prepared. Apply it in the existing Supabase SQL editor, or supply DATABASE_URL privately and run this script with its apply option. No database changes made.');process.exit(0)}
if(!env.DATABASE_URL)throw new Error('The private Supabase connection string is not configured.')
const {default:postgres}=await import('postgres')
const sql=postgres(env.DATABASE_URL,{ssl:{rejectUnauthorized:true},max:1,onnotice:()=>{}})
try{await sql.begin(async transaction=>{await transaction.unsafe(source)});console.log('Cloud worker schema applied in one database transaction. Existing broker and journal tables were not replaced.')}
catch(error){console.error('Database migration did not complete. PostgreSQL error code: '+(error.code??'connection unavailable'));process.exitCode=1}
finally{await sql.end()}
