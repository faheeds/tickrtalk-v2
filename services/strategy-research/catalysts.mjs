export function newsEvidence(items,symbol,asOf,{maximumAgeHours=96}={}){
 const cutoff=Date.parse(asOf)
 if(!Number.isFinite(cutoff))throw new Error('A valid historical decision time is required.')
 return items.filter(item=>{
  const created=Date.parse(item.created_at),updated=Date.parse(item.updated_at??item.created_at)
  return Array.isArray(item.symbols)&&item.symbols.includes(symbol)&&typeof item.headline==='string'&&typeof item.url==='string'&&/^https:\/\//.test(item.url)&&Number.isFinite(created)&&Number.isFinite(updated)&&created<=cutoff&&updated<=cutoff&&cutoff-created<=maximumAgeHours*3600000
 }).map(item=>({id:String(item.id),symbol,headline:item.headline,source:item.source??'Alpaca news',url:item.url,publishedAt:item.created_at,updatedAt:item.updated_at??item.created_at,status:'evidence_requires_review',verified:false})).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))
}
