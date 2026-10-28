import {sleep} from 'workflow'
export async function researchAnalysis(jobId:string){
 'use workflow'
 try{
  for(let poll=0;poll<60;poll++){
   if((await checkResearch(jobId)).done)return
   await sleep('30s')
  }
  if((await checkResearch(jobId)).done)return
 }catch{
  // Step retries are exhausted. Store a terminal state without exposing provider errors.
 }
 await stopResearch(jobId)
}
async function stopResearch(jobId:string){
 'use step'
 const {failResearchJob}=await import('../services/research/cloud.mjs')
 await failResearchJob(jobId)
}
async function checkResearch(jobId:string){
 'use step'
 const {researchStep}=await import('../services/research/cloud.mjs')
 return researchStep(jobId)
}
