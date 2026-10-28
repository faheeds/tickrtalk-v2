import {supabaseAdmin} from './supabase'
import type {Screening} from './workspace/types'

export async function savedScreenings(userId:string):Promise<Screening[]>{
 const reports:Screening[]=[]
 for(let offset=0;offset<10000;offset+=1000){
  const {data,error}=await supabaseAdmin.from('screening_assessments').select('report').eq('user_id',userId).order('symbol').range(offset,offset+999)
  if(error)throw new Error('Saved screening results could not be loaded. Please try again shortly.')
  reports.push(...(data??[]).map(row=>row.report as Screening))
  if(!data||data.length<1000)return reports
 }
 throw new Error('Saved screening results exceed the current account limit.')
}

export async function saveScreenings(userId:string,results:Screening[]){
 if(!results.length)return
 const {error}=await supabaseAdmin.rpc('save_screening_assessments',{p_user_id:userId,p_results:results})
 if(error)throw new Error('Screening results could not be saved to your account. Please try again.')
}
