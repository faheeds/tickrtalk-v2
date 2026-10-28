import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {mean,median,opening} from './model.mjs'
const eastern=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
const minute=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5))
export function normalizeCalendar(rows){return rows.map(row=>{const p=Object.fromEntries(eastern.formatToParts(new Date(row.date+'T16:00:00Z')).map(p=>[p.type,p.value])),offset=960-(Number(p.hour)*60+Number(p.minute)),open=minute(row.open);return {...row,minutes:minute(row.close)-open,utcOpen:Date.parse(row.date+'T00:00:00Z')+(open+offset)*60000}})}
export function dailyFeatures(daily,date){
 const prior=daily.filter(b=>b.t.slice(0,10)<date),last=prior.at(-1)
 if(prior.length<51)return null
 const ranges=prior.slice(-14).map((b,j)=>{const previous=prior[prior.length-14+j-1];return Math.max(b.h-b.l,Math.abs(b.h-previous.c),Math.abs(b.l-previous.c))})
 return {previousClose:last.c,sma20:mean(prior.slice(-20).map(b=>b.c)),sma50:mean(prior.slice(-50).map(b=>b.c)),atr:mean(ranges)}
}
export function normalizeSymbol(symbol,raw,daily,calendar){
 const days=new Map(),lookup=new Map(calendar.map(d=>[d.date,d]));let regularBars=0,invalidBars=0
 for(const session of calendar){const day={symbol,features:dailyFeatures(daily,session.date),openingHistory:{}};for(const key of ['o','h','l','c','v','vwap']){day[key]=new Float64Array(session.minutes);day[key].fill(NaN)}days.set(session.date,day)}
 let lastTimestamp=-Infinity
 for(const bar of raw){
  const timestamp=Date.parse(bar.t);if(timestamp<=lastTimestamp)throw new Error(symbol+': duplicate or unsorted bars');lastTimestamp=timestamp
  const date=bar.t.slice(0,10),session=lookup.get(date);if(!session)continue
  const i=(timestamp-session.utcOpen)/60000;if(!Number.isInteger(i)||i<0||i>=session.minutes)continue
  if(![bar.o,bar.h,bar.l,bar.c,bar.v].every(Number.isFinite)||Math.min(bar.o,bar.h,bar.l,bar.c)<=0||bar.l>Math.min(bar.o,bar.c)||bar.h<Math.max(bar.o,bar.c)||bar.v<0){invalidBars++;continue}
  const day=days.get(date);for(const key of ['o','h','l','c','v'])day[key][i]=bar[key];regularBars++
 }
 const openingVolumes={15:[],30:[]};let missingOpening15=0,missingOpening30=0,noBars=0
 for(const session of calendar){
  const day=days.get(session.date);let tpv=0,volume=0,seen=0
  for(let i=0;i<session.minutes;i++)if(Number.isFinite(day.c[i])){tpv+=(day.h[i]+day.l[i]+day.c[i])/3*day.v[i];volume+=day.v[i];day.vwap[i]=volume?tpv/volume:NaN;seen++}
  if(!seen)noBars++
  if(day.features)day.features.gap=day.o[0]/day.features.previousClose-1
  for(const n of [15,30]){const history=openingVolumes[n];day.openingHistory[n]=history.length>=15?median(history.slice(-20)):NaN;const orb=opening(day,n);if(orb)history.push(orb.volume);else if(n===15)missingOpening15++;else missingOpening30++}
 }
 return {days,coverage:{symbol,regularBars,invalidBars,missingOpening15,missingOpening30,noBars}}
}
export function loadResearchData(protocol,root='.local-run/strategy-research/'){
 const manifest=JSON.parse(readFileSync(root+'manifest.json','utf8'))
 if(manifest.feed!==protocol.feed||manifest.adjustment!==protocol.adjustment)throw new Error('Research data feed or adjustment differs from protocol.')
 const calendar=normalizeCalendar(JSON.parse(readFileSync(root+'calendar.json','utf8'))),series=new Map(),coverage=[]
 const read=file=>{const bytes=readFileSync(root+file),expected=manifest.files.find(f=>f.file===file)?.sha256;if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Market data checksum mismatch: '+file);return JSON.parse(bytes.toString('utf8'))}
 for(const symbol of [...protocol.symbols,protocol.marketProxy]){const result=normalizeSymbol(symbol,read(symbol+'-1Min.json'),read(symbol+'-1Day.json'),calendar);series.set(symbol,result.days);coverage.push(result.coverage);console.log('Prepared',symbol,result.coverage.regularBars,'regular-session bars')}
 return {calendar,series,coverage,manifest}
}
