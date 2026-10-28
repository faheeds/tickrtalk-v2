'use client'
import {useCallback,useEffect,useState} from 'react'
import type {PaperSnapshot} from '@/lib/paper/types'
export function usePaper(){
  const [data,setData]=useState<PaperSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
  const refresh=useCallback(async(signal?:AbortSignal)=>{const response=await fetch('/api/paper',{cache:'no-store',signal}),body=await response.json();if(!response.ok)throw new Error(body.error??'Paper service unavailable.');setData(body);setError('');return body as PaperSnapshot},[])
  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;async function poll(){try{await refresh(controller.signal)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Paper service unavailable.')}finally{if(!controller.signal.aborted){setLoading(false);timer=setTimeout(poll,10000)}}}void poll();return()=>{controller.abort();clearTimeout(timer)}},[refresh])
  async function action(action:string,input:Record<string,unknown>={}){setBusy(true);setError('');try{const response=await fetch('/api/paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...input})}),body=await response.json();if(!response.ok)throw new Error(body.error??'Paper action failed.');await refresh();return body}catch(e){setError(e instanceof Error?e.message:'Paper action failed.');return null}finally{setBusy(false)}}
  return {data,error,busy,loading,action,refresh}
}
