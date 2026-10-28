import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs'
import {resolve} from 'node:path'

export const SP500_SOURCE='https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'
const file=resolve(process.cwd(),'services/paper/data/sp500.json')
let memorySnapshot=null
export function setSp500Snapshot(snapshot){memorySnapshot=snapshot}
export function parseConstituents(csv){
  const rows=[];let row=[],field='',quoted=false
  for(let i=0;i<csv.length;i++){
    const char=csv[i]
    if(char==='"'){if(quoted&&csv[i+1]==='"'){field+='"';i++}else quoted=!quoted}
    else if(!quoted&&(char===','||char==='\n')){row.push(field.replace(/\r$/,''));field='';if(char==='\n'){rows.push(row);row=[]}}
    else field+=char
  }
  if(quoted)throw new Error('Constituent source has an invalid CSV record.')
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}
  const header=rows.shift(),symbol=header?.indexOf('Symbol'),name=header?.indexOf('Security'),sector=header?.indexOf('GICS Sector')
  if(symbol<0||name<0||sector<0)throw new Error('Constituent source schema changed.')
  const members=rows.filter(r=>r.some(Boolean)).map(r=>({symbol:r[symbol],name:r[name],sector:r[sector]}))
  if(members.length<450||members.length>600||new Set(members.map(m=>m.symbol)).size!==members.length||members.some(m=>! /^[A-Z][A-Z0-9.-]{0,9}$/.test(m.symbol)||!m.name||!m.sector))throw new Error('Constituent source is incomplete or invalid.')
  return members.sort((a,b)=>a.symbol.localeCompare(b.symbol))
}
export function sp500Snapshot(){
  if(memorySnapshot)return memorySnapshot
  try{const value=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(value.members)||value.members.length<450)throw new Error('Invalid snapshot');return value}catch{return null}
}
export async function refreshSp500(fetcher=fetch){
  const response=await fetcher(SP500_SOURCE,{signal:AbortSignal.timeout(15000),cache:'no-store'})
  if(!response.ok)throw new Error('S&P 500 constituent source is unavailable. The published universe is unchanged.')
  const csv=await response.text();if(csv.length>1000000)throw new Error('Constituent source exceeds the expected size.')
  const value={name:'S&P 500',source:SP500_SOURCE,retrievedAt:new Date().toISOString(),members:parseConstituents(csv),note:'Public constituent snapshot sourced from Wikipedia. Not an official real-time index feed.'}
  memorySnapshot=value
  if(!process.env.VERCEL){mkdirSync(resolve(process.cwd(),'services/paper/data'),{recursive:true});writeFileSync(file+'.tmp',JSON.stringify(value,null,2)+'\n');renameSync(file+'.tmp',file)}
  return value
}
export function resolveUniverse(draft){
  if(draft.universeMode!=='sp500')return draft
  const snapshot=sp500Snapshot();if(!snapshot)throw new Error('Refresh the S&P 500 constituent snapshot first.')
  if(Date.now()-new Date(snapshot.retrievedAt).getTime()>7*86400000)throw new Error('Refresh the S&P 500 snapshot before publishing a new draft.')
  return {...draft,universe:snapshot.members.map(m=>m.symbol),universeAsOf:snapshot.retrievedAt,universeSource:snapshot.source}
}
