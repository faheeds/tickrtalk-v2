import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {loadResearchData} from '../services/strategy-research/data.mjs'
import {variants,simulate,qualification,blockBootstrapInterval} from '../services/strategy-research/model.mjs'
const source=readFileSync('services/strategy-research/protocol.json','utf8'),protocol=JSON.parse(source),hash=createHash('sha256').update(source).digest('hex')
const out='reports/day-strategy-research-2026-10-15/';mkdirSync(out,{recursive:true})
const data=loadResearchData(protocol),candidates=variants(protocol.grid),compact=({curve,tradeLog,dailyReturns,...r})=>r
const development=candidates.map(parameters=>{const result=simulate(data,parameters,protocol,protocol.splits.development);return {...compact(result),qualification:qualification(result,'development',protocol)}})
const ranked=[...development].sort((a,b)=>b.score-a.score||a.maximumDailyDrawdownPct-b.maximumDailyDrawdownPct||a.parameters.id.localeCompare(b.parameters.id)),eligible=ranked.filter(r=>r.qualification.passed),selected=(eligible[0]??ranked[0]).parameters
const modelHash=createHash('sha256').update(readFileSync('services/strategy-research/model.mjs')).update(readFileSync('services/strategy-research/data.mjs')).digest('hex'),freezePath=out+'selection.json'
const freeze={protocolHash:hash,modelHash,selected,developmentQualified:eligible.length>0,developmentCandidates:development.map(compact),selectedBeforeValidationAndTest:new Date().toISOString()}
if(existsSync(freezePath)){const previous=JSON.parse(readFileSync(freezePath,'utf8'));if(previous.protocolHash!==hash||previous.modelHash!==modelHash||JSON.stringify(previous.selected)!==JSON.stringify(selected))throw new Error('Frozen candidate differs. Preserve the old experiment and register a separate experiment before changing rules.')}
else writeFileSync(freezePath,JSON.stringify(freeze,null,2),{flag:'wx'})
console.log('Frozen development selection:',selected.id,'qualified:',eligible.length>0)
const phases={}
for(const [phase,split]of Object.entries(protocol.splits)){
 const baseline=simulate(data,selected,protocol,split),stress=simulate(data,selected,protocol,split,{slippageBps:protocol.costs.stressSlippageBps})
 phases[phase]={baseline:{...baseline,qualification:qualification(baseline,phase,protocol),bootstrap:blockBootstrapInterval(baseline.dailyReturns)},stress:{...stress,qualification:qualification(stress,phase,protocol)}}
 console.log(phase,JSON.stringify({returnPct:baseline.returnPct,trades:baseline.trades,qualified:phases[phase].baseline.qualification,stressReturnPct:stress.returnPct}))
}
const rejection=[]
if(!eligible.length)rejection.push('No development candidate satisfied the preregistered requirements.')
for(const [phase,result]of Object.entries(phases)){if(!result.baseline.qualification.passed)rejection.push(phase+': '+result.baseline.qualification.reasons.join(', '));if(!result.stress.qualification.passed)rejection.push(phase+' stressed costs: '+result.stress.qualification.reasons.join(', '))}
if(!(phases.test.baseline.bootstrap?.lowerDailyMean>0))rejection.push('Test block-bootstrap interval does not establish a positive mean return.')
const result={generatedAt:new Date().toISOString(),protocolHash:hash,modelHash,protocol,selection:JSON.parse(readFileSync(freezePath,'utf8')),coverage:data.coverage,dataManifest:data.manifest,decision:rejection.length?'REJECTED_FOR_PROMOTION':'PAPER_VALIDATION_CANDIDATE',rejection,phases}
writeFileSync(out+'results.json',JSON.stringify(result,null,2))
for(const [phase,{baseline}]of Object.entries(phases)){const columns=['date','symbol','qty','entryMinute','exitMinute','entry','exit','pnl','reason'];writeFileSync(out+phase+'-trades.csv',columns.join(',')+'\n'+baseline.tradeLog.map(t=>columns.map(c=>t[c]).join(',')).join('\n'))}
writeFileSync(out+'protocol.json',source)
console.log('Decision:',result.decision)
