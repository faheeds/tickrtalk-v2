import {createPaperActions} from './actions.mjs'
import {createServer} from 'node:http'
import {readFileSync,existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {timingSafeEqual,createHash,randomUUID} from 'node:crypto'
import dotenv from 'dotenv'
import {PaperStore} from './store.mjs'
import {PaperEngine} from './engine.mjs'
import {clientId,DEFAULT_DRAFT,flattenOrders,isOpen,validateDraft} from './core.mjs'
import {paperBroker} from './broker.mjs'
import {sp500Snapshot,refreshSp500,resolveUniverse,setSp500Snapshot} from './universe.mjs'

export const ROOT=resolve(process.cwd())
const configPath=resolve(ROOT,'.env.paper')
export function privateConfig(){return existsSync(configPath)?dotenv.parse(readFileSync(configPath)): {}}
export function createPaperService(options){
  const {dispatch,importLocal}=createPaperActions(options),{token}=options
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    try{
      const provided=req.headers.authorization??'',expected='Bearer '+token
      if(token.length<32||Buffer.byteLength(provided)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))throw Object.assign(new Error('Unauthorized'),{status:401})
      const user=req.headers['x-paper-user'],owner=req.headers['x-paper-role']==='owner'
      if(typeof user!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(user))throw Object.assign(new Error('Trusted account identity required.'),{status:400})
      if(req.url!=='/api'||!['GET','POST'].includes(req.method))throw Object.assign(new Error('Not found'),{status:404})
      let input={}
      if(req.method==='POST'){
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)throw Object.assign(new Error('Request too large.'),{status:413})}
        try{input=JSON.parse(body)}catch{throw Object.assign(new Error('Invalid request body.'),{status:400})}
        if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid request.')
      }
      const result=await dispatch(user,owner,req.method==='GET'?'status':input.action,input)
      res.end(JSON.stringify(result))
    }catch(e){res.statusCode=e.status??400;res.end(JSON.stringify({error:e.code?.startsWith('SQLITE')?'Paper storage rejected this request. Check account ownership.':e.message??'Paper service unavailable.'}))}
  })
  return {server,dispatch,importLocal}
}
if(process.argv[1]&&import.meta.filename&&resolve(process.argv[1])===resolve(import.meta.filename)){
  if(existsSync(resolve(ROOT,'.paper-data/cloud-cutover.json')))throw new Error('Local paper execution has moved to Vercel. Use the hosted workspace; do not start a second paper worker.')
  const settings=privateConfig();if((settings.PAPER_SERVICE_TOKEN??'').length<32)throw new Error('A private paper service token is required.')
  const store=new PaperStore(resolve(ROOT,'.paper-data'),settings.PAPER_ENCRYPTION_KEY),engine=new PaperEngine(store,{screeningUrl:process.env.AAOIFI_URL??settings.AAOIFI_URL??''})
  const {server}=createPaperService({store,engine,token:settings.PAPER_SERVICE_TOKEN??'',localCredentials:()=>{const values=privateConfig();return {key:values.ALPACA_PAPER_API_KEY,secret:values.ALPACA_PAPER_API_SECRET}}})
  server.listen(Number(settings.PAPER_PORT??8003),'127.0.0.1',()=>console.log('Paper execution service listening on port '+(settings.PAPER_PORT??8003)))
  const timer=setInterval(()=>{void engine.tick().catch(()=>store.log(null,'worker_error','Paper worker cycle failed.'))},15000);void engine.tick()
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(timer);engine.close();server.close();setTimeout(()=>process.exit(0),1000).unref()})
}
