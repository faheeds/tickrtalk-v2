'use client'
import {useEffect,useRef} from 'react'
import {Chart,LineController,LineElement,PointElement,LinearScale,CategoryScale,Filler,Tooltip,type Plugin} from 'chart.js'
import {money} from './primitives'

Chart.register(LineController,LineElement,PointElement,LinearScale,CategoryScale,Filler,Tooltip)
export function CapitalChart({points,baseline,currency}:{points:{date:string;value:number}[];baseline:number[];currency:string}){
 const ref=useRef<HTMLCanvasElement>(null)
 useEffect(()=>{
  if(!ref.current)return
  const hasBaseline=baseline.length===points.length
  const date=(value:string)=>new Intl.DateTimeFormat(currency==='INR'?'en-IN':'en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value))
  const endpointLabels:Plugin<'line'>={id:'capital-endpoints',beforeLayout(chart){chart.options.layout??={};chart.options.layout.padding={right:chart.width>=650?145:0}},afterDraw(chart){
   if(chart.width<650)return
   const {ctx,chartArea}=chart
   ctx.save();ctx.textAlign='left'
   chart.data.datasets.forEach((dataset,i)=>{const point=chart.getDatasetMeta(i).data.at(-1);if(!point)return;const y=Math.max(chartArea.top+16,Math.min(chartArea.bottom-20,point.y));ctx.fillStyle=i?'#a4c8de':'#72dfbb';ctx.font='500 14px Arial';ctx.fillText(money(dataset.data.at(-1) as number,false,currency),chartArea.right+12,y-5);ctx.font='11px Arial';ctx.fillStyle='#b9ccd8';ctx.fillText(i?'Starting value +':'Account value',chartArea.right+12,y+12);if(i)ctx.fillText('net deposits',chartArea.right+12,y+27)})
   ctx.restore()
  }}
  const chart=new Chart(ref.current,{type:'line',plugins:[endpointLabels],data:{labels:points.map(p=>p.date),datasets:[{label:'Account value',data:points.map(p=>p.value),borderColor:'#72dfbb',borderWidth:2,pointRadius:0,pointHoverRadius:4,pointHitRadius:18,tension:0,fill:hasBaseline?{target:1,above:'#62c9a61a',below:'#e8828218'}:false},...(hasBaseline?[{label:'Starting value + net deposits',data:baseline,borderColor:'#a4c8de',borderDash:[7,6],borderWidth:1.5,pointRadius:0,pointHoverRadius:3,stepped:true as const,fill:false}]:[])]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:'#203241',titleColor:'#ecf1f3',bodyColor:'#d7e7ef',padding:12,callbacks:{title:items=>date(items[0]?.label??points[0].date),label:item=>`${item.dataset.label}: ${money(item.parsed.y,false,currency)}`,afterBody:items=>hasBaseline?`Investment result: ${money(points[items[0].dataIndex].value-baseline[items[0].dataIndex],true,currency)}`:''}}},scales:{x:{afterBuildTicks:axis=>{const count=Math.min(axis.chart.width<550?3:5,points.length);axis.ticks=Array.from({length:count},(_,i)=>({value:Math.round(i*(points.length-1)/(count-1))}))},grid:{display:false},border:{display:false},ticks:{autoSkip:false,color:'#96afbf',maxRotation:0,callback:value=>new Intl.DateTimeFormat('en-US',{month:'short',...(Date.parse(points.at(-1)!.date)-Date.parse(points[0].date)<86400000*100?{day:'numeric' as const}:{year:'2-digit' as const}),timeZone:'UTC'}).format(new Date(points[Number(value)].date)),font:{size:11}}},y:{border:{display:false},grid:{color:'#263945'},ticks:{color:'#96afbf',maxTicksLimit:5,callback:value=>new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{style:'currency',currency,notation:'compact',maximumFractionDigits:1}).format(Number(value)),font:{size:11}}}}}})
  return()=>chart.destroy()
 },[points,baseline,currency])
 return <><div className="capital-chart"><canvas ref={ref} role="img" aria-label={`Account value, ${points[0].date} to ${points.at(-1)?.date}. Ending value ${money(points.at(-1)?.value??null,false,currency)}. ${baseline.length?'Dashed line shows starting value plus net deposits.':'Contribution comparison unavailable.'} Detailed observations follow.`}/></div><div className="capital-legend"><span><i className="value-line" aria-hidden="true"/>Account value</span>{baseline.length?<span><i className="contribution-line" aria-hidden="true"/>Starting value + net deposits</span>:null}</div><details className="capital-data"><summary>View chart data</summary><div className="table-wrap"><table className="ws-table"><caption>Broker account values in {currency}</caption><thead><tr><th>Date</th><th>Account value</th>{baseline.length?<><th>Starting value + net deposits</th><th>Investment result</th></>:null}</tr></thead><tbody>{points.map((point,i)=><tr key={point.date}><td>{point.date}</td><td>{money(point.value,false,currency)}</td>{baseline.length?<><td>{money(baseline[i],false,currency)}</td><td>{money(point.value-baseline[i],true,currency)}</td></>:null}</tr>)}</tbody></table></div></details></>
}
