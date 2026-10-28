import {cpSync,copyFileSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {resolve,dirname,basename,sep} from 'node:path'
const root=resolve('.'),stage=resolve('.vercel-staging')
if(!stage.startsWith(root+sep)||basename(stage)!=='.vercel-staging')throw new Error('Invalid staging path.')
mkdirSync(stage,{recursive:true})
// Replace generated source trees only. Preserve the existing Vercel project attachment.
for(const name of ['app','lib','public','workflows','services']){
 const target=resolve(stage,name);if(dirname(target)!==stage)throw new Error('Staging path escaped its directory.')
 rmSync(target,{recursive:true,force:true})
}
const safe=source=>!source.split(/[\\/]/).some(part=>part.startsWith('.env')||part==='__pycache__'||part==='.well-known')
for(const name of ['app','lib','public','workflows'])cpSync(name,resolve(stage,name),{recursive:true,filter:safe})
for(const name of ['actions.mjs','broker.mjs','checkpoint.mjs','cloud.mjs','core.mjs','engine.mjs','schedule.ts','store.mjs','universe.mjs','data']){
 const target=resolve(stage,'services/paper',name);mkdirSync(dirname(target),{recursive:true});cpSync(resolve('services/paper',name),target,{recursive:true,filter:safe})
}
for(const name of ['cloud.mjs','cloud.d.mts','runner.py','reports.py','cloud_boot.py','requirements.lock.txt','vendor']){
 const target=resolve(stage,'services/research',name);mkdirSync(dirname(target),{recursive:true});cpSync(resolve('services/research',name),target,{recursive:true,filter:safe})
}
for(const name of ['package.json','package-lock.json','next.config.js','next-env.d.ts','tsconfig.json','tailwind.config.ts','postcss.config.js','proxy.ts','vercel.json'])copyFileSync(name,resolve(stage,name))
mkdirSync(resolve(stage,'.vercel'),{recursive:true});copyFileSync('.vercel/project.json',resolve(stage,'.vercel/project.json'))
writeFileSync(resolve(stage,'.vercelignore'),'.env*\n**/.env*\nnode_modules/\n.next/\n.vercel/\n')
if(existsSync(resolve(stage,'.env.hosted'))||existsSync(resolve(stage,'.paper-data')))throw new Error('Private data entered the deployment package.')
console.log('Prepared Vercel source with workflows and the pinned TradingAgents engine. Credentials, trading databases and saved reports are excluded.')
