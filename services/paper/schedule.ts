import {start} from 'workflow/api'
import {paperMonitoring} from '@/workflows/paper'
import {cloudDatabase} from '@/lib/deployment/database.mjs'
export async function startCloudPaper(){
 if(process.env.VERCEL_ENV!=='production'||process.env.PAPER_RUNTIME!=='cloud')throw new Error('Production cloud runtime required.')
 const database=cloudDatabase(),generation=crypto.randomUUID()
 await database('paper_cloud_state?id=eq.1',{method:'PATCH',body:{generation}})
 try{const run=await start(paperMonitoring,[generation]);return {started:true,runId:run.runId}}
 catch(error){await database(`paper_cloud_state?id=eq.1&generation=eq.${generation}`,{method:'PATCH',body:{generation:null}}).catch(()=>{});throw error}
}
