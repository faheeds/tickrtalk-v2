import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {simulateBroad} from '../services/strategy-research/broad-simulation.mjs'
const root='.local-run/broad-strategy/',out='reports/broad-strategy-2026-10-16/',baseline=JSON.parse(readFileSync(out+'results.json','utf8')),index=JSON.parse(readFileSync(root+'signals.json','utf8')),manifest=JSON.parse(readFileSync(root+'execution-manifest.json','utf8'))
const sha=b=>createHash('sha256').update(b).digest('hex'),modelHash=sha(Buffer.concat(['broad-signals.mjs','broad-simulation.mjs','universe-scanner.mjs','model.mjs','broad-data-hashes.mjs','nominal-prices.mjs'].map(f=>readFileSync('services/strategy-research/'+f))))
if(modelHash!==baseline.modelHash)throw new Error('Frozen strategy model changed. Do not replace this experiment.')
const protocol={...baseline.protocol,costs:{...baseline.protocol.costs,sellFeePerShare:0}},data={...index,readSession(date){const file='execution/'+date+'.json',bytes=readFileSync(root+file);if(sha(bytes)!==manifest.files.find(f=>f.file===file)?.sha256)throw new Error('Execution history changed.');return JSON.parse(bytes)}}
const runs={}
for(const [name,split]of Object.entries({...protocol.splits,continuous:protocol.period})){const result=simulateBroad(data,baseline.selection.selected,protocol,split);runs[name]={pnl:result.pnl,returnPct:result.returnPct,trades:result.trades,maximumDailyDrawdownPct:result.maximumDailyDrawdownPct}}
writeFileSync(out+'fee-sensitivity.json',JSON.stringify({generatedAt:new Date().toISOString(),postHocDiagnostic:true,selectionUnchanged:true,selected:baseline.selection.selected,assumption:'No sell fees; original spread and slippage retained. This is an optimistic fee bound, not a reconstruction of actual broker fees. Not used to select or promote a strategy.',source:'https://alpaca.markets/support/commission-clearing-fees',runs},null,2));console.log(JSON.stringify(runs))
