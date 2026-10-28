'use client'
import {useEffect,useState} from 'react'
import type {Screening} from '@/lib/workspace/types'
export function useSavedScreenings(demo:boolean,setScreens:(reports:Record<string,Screening>)=>void){
 const [error,setError]=useState('')
  useEffect(()=>{
    if(demo)return
    const controller=new AbortController()
    let pending=false
    async function restore(){
      if(pending||document.visibilityState==='hidden')return
      pending=true
      try{const response=await fetch('/api/screening?saved=1',{signal:controller.signal,cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error('Saved screening results could not be loaded. They will be checked again shortly.');setScreens(Object.fromEntries((body.results as Screening[]).map(report=>[report.ticker,report])));setError('')}
      catch(error){if(!controller.signal.aborted)setError('Saved screening results could not be loaded. They will be checked again shortly.')}
      finally{pending=false}
    }
    void restore()
    window.addEventListener('focus',restore);document.addEventListener('visibilitychange',restore)
    const timer=window.setInterval(restore,60000)
    return()=>{controller.abort();window.removeEventListener('focus',restore);document.removeEventListener('visibilitychange',restore);window.clearInterval(timer)}
  },[demo,setScreens])
 return error
}
