// Browser revalidation may finish after a newer manual screen. Keep the newer assessment.
export function mergeScreenings(current,next){
 const merged={...current}
 for(const [symbol,report] of Object.entries(next)){
  if(!report||report.ticker!==symbol||!['pass','review','fail','unavailable'].includes(report.status)||!Number.isFinite(Date.parse(report.asOf)))continue
  if(!merged[symbol]||Date.parse(report.asOf)>=Date.parse(merged[symbol].asOf))merged[symbol]=report
 }
 return merged
}
