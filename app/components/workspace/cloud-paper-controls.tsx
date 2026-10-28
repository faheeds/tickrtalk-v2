'use client'
import {useState} from 'react'
import {Button,Notice} from './primitives'
import type {PaperSnapshot} from '@/lib/paper/types'
export function CloudPaperControls({worker}: {worker:PaperSnapshot['worker']}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false)
 if(worker.runtime!=='cloud')return null
 async function start(){
  setBusy(true);setMessage('');setFailed(false)
  try{const response=await fetch('/api/owner/cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'start_monitoring'})}),body=await response.json();if(!response.ok)throw new Error(body.error??'Cloud monitoring could not start.');setMessage(body.executionEnabled?'Cloud paper monitoring started. Existing authorizations and limits apply.':'Cloud monitoring started in observation mode. Order placement awaits the verified cutover.')}
  catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'Cloud monitoring could not start.')}
  finally{setBusy(false)}
 }
 return <section className="research-connection"><div><strong>Vercel paper monitoring</strong><p>{worker.nextCheckAt?`Next scheduled check: ${new Date(worker.nextCheckAt).toLocaleString()}.`:'Monitoring has not scheduled its first check yet.'} Checks continue independently of this browser.</p>{message?<Notice warning={failed}>{message}</Notice>:null}</div><Button secondary disabled={busy} onClick={start}>{busy?'Starting…':'Start cloud monitoring'}</Button></section>
}
