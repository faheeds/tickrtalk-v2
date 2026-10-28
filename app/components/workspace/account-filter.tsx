'use client'
import {useEffect,useId,useRef,useState} from 'react'
import {CaretDown,Wallet} from '@phosphor-icons/react'
import type {Account} from '@/lib/workspace/types'

export function useRememberedAccounts(storageKey:string|null){
  const [saved,setSaved]=useState<{key:string|null;ids:string[]|null}>({key:null,ids:null})
  useEffect(()=>{
    if(!storageKey)return
    let ids:string[]|null=null
    try{const stored=JSON.parse(localStorage.getItem(storageKey)??'null');if(stored?.version===1&&(stored.ids===null||Array.isArray(stored.ids)&&stored.ids.every((id:unknown)=>typeof id==='string')))ids=stored.ids}catch{}
    setSaved({key:storageKey,ids})
  },[storageKey])
  const selection=saved.key===storageKey?saved.ids:null
  function change(ids:string[]|null){
    setSaved({key:storageKey,ids})
    if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify({version:1,ids}))}catch{}
  }
  return [selection,change] as const
}

export function AccountFilter({accounts,selection,onChange}:{accounts:Account[];selection:string[]|null;onChange:(ids:string[]|null)=>void}){
  const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId()
  const selected=accounts.filter(a=>selection===null||selection.includes(a.id))
  const label=selection===null?'All accounts':selected.length===1?`${selected[0].broker} ••${selected[0].lastFour}`:`${selected.length} accounts selected`
  useEffect(()=>{
    if(!open)return
    root.current?.querySelector<HTMLInputElement>('input')?.focus()
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}
  },[open])
  function toggle(accountId:string){const current=selection??accounts.map(a=>a.id);onChange(current.includes(accountId)?current.filter(value=>value!==accountId):[...current,accountId])}
  return <div className="journal-account-filter" ref={root}>
    <button ref={trigger} type="button" className="select-control account-filter-trigger" aria-label={`Filter journal by account: ${label}`} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={()=>setOpen(!open)}><Wallet size={16}/><span>{label}</span><CaretDown size={14}/></button>
    {open?<div id={id} role="dialog" aria-label="Choose journal accounts" className="account-filter-menu"><div className="account-filter-heading"><strong>Accounts to include</strong><span>{selected.length} of {accounts.length} selected</span></div><label className="account-filter-option all-accounts"><input type="checkbox" checked={selection===null} onChange={()=>onChange(selection===null?[]:null)}/><span><strong>All accounts</strong><small>Include newly connected accounts too</small></span></label><div className="account-filter-options">{accounts.map(account=><label className="account-filter-option" key={account.id}><input type="checkbox" checked={selection===null||selection.includes(account.id)} onChange={()=>toggle(account.id)}/><span><strong>{account.broker} ••{account.lastFour}</strong><small>{account.name}</small></span></label>)}{!accounts.length?<p className="small-text">No connected accounts yet.</p>:null}</div><div className="account-filter-footer"><span>Remembered in this browser</span><button className="text-link" type="button" onClick={()=>{setOpen(false);trigger.current?.focus()}}>Done</button></div></div>:null}
  </div>
}
