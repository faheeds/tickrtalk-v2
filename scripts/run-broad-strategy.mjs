import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {qualification,blockBootstrapInterval} from '../services/strategy-research/model.mjs'
import {simulateBroad} from '../services/strategy-research/broad-simulation.mjs'
import {signalFingerprint,executionFingerprint} from '../services/strategy-research/broad-data-hashes.mjs'
const root='.local-run/broad-strategy/',out='reports/broad-strategy-2026-10-16/',source=readFileSync('services/strategy-research/broad-protocol.json','utf8'),protocol=JSON.parse(source),index=JSON.parse(readFileSync(root+'signals.json','utf8')),manifest=JSON.parse(readFileSync(root+'execution-manifest.json','utf8'))
const sha=b=>createHash('sha256').update(b).digest('hex'),protocolHash=sha(source),modelHash=sha(Buffer.concat(['broad-signals.mjs','broad-simulation.mjs','universe-scanner.mjs','model.mjs','broad-data-hashes.mjs','nominal-prices.mjs'].map(f=>readFileSync('services/strategy-research/'+f)))),signalHash=signalFingerprint(index)
if(manifest.adjustment!==protocol.executionAdjustment)throw new Error('Execution prices do not match the nominal-price protocol.')
if(index.protocolHash!==protocolHash||manifest.signalHash!==signalHash)throw new Error('Protocol or signal data changed. Rebuild the dependent stages first.')
mkdirSync(out,{recursive:true})
const readSession=date=>{const file='execution/'+date+'.json',bytes=readFileSync(root+file);if(sha(bytes)!==manifest.files.find(f=>f.file===file)?.sha256)throw new Error('Execution data checksum mismatch');return JSON.parse(bytes)}
const data={...index,readSession},combinations=protocol.arms.flatMap(arm=>protocol.setups.map(setup=>({id:arm+'-'+setup,arm,setup}))),compact=({tradeLog,curve,dailyReturns,...r})=>r
const qualify=(result,phase)=>{const gate=qualification(result,phase,protocol);if(result.diagnostics.missingHoldingBars){gate.reasons.push('missing minute bars during exposure');gate.passed=false}return gate}
const development=combinations.map(parameters=>{const result=simulateBroad(data,parameters,protocol,protocol.splits.development);return {...compact(result),qualification:qualify(result,'development')}})
const ranked=[...development].sort((a,b)=>b.score-a.score||a.maximumDailyDrawdownPct-b.maximumDailyDrawdownPct||a.parameters.id.localeCompare(b.parameters.id)),eligible=ranked.filter(r=>r.qualification.passed),selected=(eligible[0]??ranked[0]).parameters
const freeze={selected,developmentQualified:eligible.length>0,protocolHash,modelHash,signalHash,executionManifestHash:executionFingerprint(manifest),selectedBeforeLaterResults:new Date().toISOString(),development},path=out+'selection.json'
if(existsSync(path)){const previous=JSON.parse(readFileSync(path,'utf8'));if(['protocolHash','modelHash','signalHash','executionManifestHash'].some(k=>previous[k]!==freeze[k])||previous.selected.id!==selected.id)throw new Error('Frozen experiment differs. Register a separate experiment instead of replacing it.')}
else writeFileSync(path,JSON.stringify(freeze,null,2),{flag:'wx'})
console.log('Frozen selection',selected.id,'development passed',eligible.length>0)
const comparisons={}
for(const parameters of combinations){const phases={};for(const [phase,split]of Object.entries(protocol.splits)){const baseline=simulateBroad(data,parameters,protocol,split),stress=simulateBroad(data,parameters,protocol,split,{slippageBps:protocol.costs.stressSlippageBps});phases[phase]={baseline:{...baseline,qualification:qualify(baseline,phase),bootstrap:blockBootstrapInterval(baseline.dailyReturns)},stress:{...stress,qualification:qualify(stress,phase)}};console.log(parameters.id,phase,baseline.returnPct,baseline.trades)}comparisons[parameters.id]={parameters,phases}}
const candidate=comparisons[selected.id],rejection=[]
const continuous={baseline:simulateBroad(data,selected,protocol,protocol.period),stress:simulateBroad(data,selected,protocol,protocol.period,{slippageBps:protocol.costs.stressSlippageBps})}
if(!eligible.length)rejection.push('No development combination qualified.')
for(const [phase,result]of Object.entries(candidate.phases))for(const scenario of ['baseline','stress'])if(!result[scenario].qualification.passed)rejection.push(phase+' '+scenario+': '+result[scenario].qualification.reasons.join(', '))
if(!(candidate.phases.test.baseline.bootstrap?.lowerDailyMean>0))rejection.push('Positive mean test return was not established by the block bootstrap.')
rejection.push('Historical AAOIFI eligibility, time-stamped catalysts, point-in-time universe and live feed compatibility are not verified.')
if(index.priceAuditExclusions.length)rejection.push(index.priceAuditExclusions.length+' stock-sessions failed the nominal-price consistency audit and were excluded before returns were calculated.')
const result={generatedAt:new Date().toISOString(),protocol,protocolHash,modelHash,selection:JSON.parse(readFileSync(path,'utf8')),comparisons,continuous,decision:'RESEARCH_ONLY_NOT_ACTIVATED',rejection,catalogCount:index.stockCount,eligibleCount:index.eligibleCount,sp500EligibleCount:index.sp500EligibleCount,shortlists:index.shortlists,signalCount:index.signals.length,priceAuditExclusions:index.priceAuditExclusions,executionSessionCount:manifest.files.length,executionManifest:manifest,coarseManifest:JSON.parse(readFileSync(root+'coarse-manifest.json','utf8'))}
writeFileSync(out+'results.json',JSON.stringify(result,null,2));writeFileSync(out+'protocol.json',source)
console.log('Result saved. Execution remains disabled.')
