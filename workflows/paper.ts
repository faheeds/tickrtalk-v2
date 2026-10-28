import {sleep} from 'workflow'

export async function paperMonitoring(generation:string){
 'use workflow'
 // Rotate runs before reaching Workflow's per-run event limit.
 for(let cycle=0;cycle<800;cycle++){
  let delay=60000
  try{
   const result=await checkPaper(generation)
   if(result.stop)return
   delay=result.delay
  }catch{
   // A provider outage must not permanently end monitoring after step retries.
   // The failed step remains visible in Workflow diagnostics; the UI becomes stale.
  }
  await sleep(delay)
 }
 await continuePaper(generation)
}
async function checkPaper(generation:string){
 'use step'
 const {cloudPaperTick}=await import('../services/paper/cloud.mjs')
 return cloudPaperTick(generation)
}
async function continuePaper(generation:string){
 'use step'
 const {start}=await import('workflow/api')
 await start(paperMonitoring,[generation])
}
