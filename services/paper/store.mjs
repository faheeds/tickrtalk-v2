import {DatabaseSync} from 'node:sqlite'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto'
import {DEFAULT_DRAFT,flattenOrders,isOpen,number} from './core.mjs'
import {buildPerformance,allocationCash,tradingDate} from '../../lib/paper/performance.mjs'

export class PaperStore {
  constructor(directory,key) {
    if (!/^[a-f0-9]{64}$/i.test(key??'')) throw new Error('A private paper encryption key is required.')
    this.key=Buffer.from(key,'hex');mkdirSync(directory,{recursive:true})
    this.db=new DatabaseSync(join(directory,'paper.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(user TEXT PRIMARY KEY,account_id TEXT UNIQUE NOT NULL,credentials TEXT NOT NULL,style TEXT NOT NULL DEFAULT 'day',budget REAL NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 0,consented TEXT,snapshot TEXT,error TEXT,updated TEXT);
      CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,body TEXT NOT NULL,owner TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),release_id TEXT,halt INTEGER NOT NULL DEFAULT 0,heartbeat TEXT,last_scan TEXT);
      INSERT OR IGNORE INTO settings(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,user TEXT NOT NULL,symbol TEXT NOT NULL,style TEXT NOT NULL,version TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL,broker_id TEXT,broker TEXT,created TEXT NOT NULL,updated TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS intent_user ON intents(user,created);
      CREATE TABLE IF NOT EXISTS observed(order_id TEXT PRIMARY KEY,qty REAL NOT NULL,notional REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS fills(id TEXT PRIMARY KEY,user TEXT NOT NULL,symbol TEXT NOT NULL,style TEXT NOT NULL,version TEXT NOT NULL,side TEXT NOT NULL,qty REAL NOT NULL,price REAL NOT NULL,time TEXT NOT NULL,order_id TEXT NOT NULL,source TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS baselines(user TEXT NOT NULL,session TEXT NOT NULL,equity REAL NOT NULL,PRIMARY KEY(user,session));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user TEXT,action TEXT NOT NULL,detail TEXT NOT NULL,time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cycles(id TEXT PRIMARY KEY,user TEXT NOT NULL,state TEXT NOT NULL,time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS allocations(id TEXT PRIMARY KEY,user TEXT NOT NULL,account_id TEXT NOT NULL,style TEXT NOT NULL,capital REAL NOT NULL,started TEXT NOT NULL,ended TEXT);
      CREATE TABLE IF NOT EXISTS performance_points(allocation_id TEXT NOT NULL,day TEXT NOT NULL,value REAL NOT NULL,observed_at TEXT NOT NULL,PRIMARY KEY(allocation_id,day));
      CREATE TABLE IF NOT EXISTS universe(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL);`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS style_authorizations(user TEXT NOT NULL,style TEXT NOT NULL,budget REAL NOT NULL,active INTEGER NOT NULL,consented TEXT,PRIMARY KEY(user,style));
      CREATE TABLE IF NOT EXISTS allocation_funding(id TEXT PRIMARY KEY,allocation_id TEXT NOT NULL,amount REAL NOT NULL,time TEXT NOT NULL);`)
    this.db.prepare('INSERT OR IGNORE INTO drafts(id,body,updated) VALUES(1,?,?)').run(JSON.stringify(DEFAULT_DRAFT),new Date().toISOString())
    this.db.prepare("UPDATE intents SET status='unknown' WHERE status='submitting'").run()
  }
  encrypt(creds) {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const bytes=Buffer.concat([cipher.update(JSON.stringify(creds),'utf8'),cipher.final()]);return [iv.toString('hex'),cipher.getAuthTag().toString('hex'),bytes.toString('hex')].join(':')}
  decrypt(value) {const [iv,tag,data]=value.split(':');const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(iv,'hex'));cipher.setAuthTag(Buffer.from(tag,'hex'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]).toString('utf8'))}
  migrateAuthorizations(){this.db.exec(`INSERT OR IGNORE INTO style_authorizations SELECT user,style,budget,active,consented FROM accounts WHERE budget>0 AND NOT EXISTS(SELECT 1 FROM style_authorizations s WHERE s.user=accounts.user)`)}
  authorizations(user){this.migrateAuthorizations();return this.db.prepare('SELECT * FROM style_authorizations WHERE user=? ORDER BY style').all(user).map(row=>({...row,active:!!row.active}))}
  account(user,style=null) {const row=this.db.prepare('SELECT * FROM accounts WHERE user=?').get(user);if(!row)return null;const parsed={...row,active:!!row.active,snapshot:row.snapshot?JSON.parse(row.snapshot):null};if(!style)return parsed;return {...parsed,style,budget:0,active:false,consented:null,...this.authorizations(user).find(a=>a.style===style)}}
  styleAccounts(user){return this.authorizations(user).map(a=>this.account(user,a.style))}
  accounts(){return this.db.prepare('SELECT user FROM accounts').all().map(row=>this.account(row.user))}
  connect(user,id,credentials) {
    const existing=this.account(user)
    if(existing&&existing.account_id!==id)this.db.prepare('DELETE FROM style_authorizations WHERE user=?').run(user)
    this.db.prepare(`INSERT INTO accounts(user,account_id,credentials,updated) VALUES(?,?,?,?) ON CONFLICT(user) DO UPDATE SET account_id=excluded.account_id,credentials=excluded.credentials,updated=excluded.updated,active=CASE WHEN accounts.account_id=excluded.account_id THEN accounts.active ELSE 0 END,budget=CASE WHEN accounts.account_id=excluded.account_id THEN accounts.budget ELSE 0 END`).run(user,id,this.encrypt(credentials),new Date().toISOString())
    this.log(user,'paper_connection',existing?.account_id===id?'Paper credentials verified.':'Paper account linked; fresh authorization required.')
  }
  snapshot(user,value,error=null){this.db.prepare('UPDATE accounts SET snapshot=?,error=?,updated=? WHERE user=?').run(JSON.stringify(value),error,new Date().toISOString(),user);if(!error&&value.observedAt)this.observePerformance(user,value)}
  authorize(user,style,budget){
    if(!['day','swing','longterm'].includes(style)||!Number.isFinite(budget)||budget<1||Math.abs(Math.round(budget*100)-budget*100)>1e-6)throw new Error('Use a valid style and a positive budget with up to two decimal places.')
    this.migrateAuthorizations();const previous=this.account(user,style),allocation=this.ensureAllocation(previous),time=new Date().toISOString()
    if(previous.budget>budget)throw new Error('Allocation reductions are not supported. Pause this style to stop new entries.')
    this.db.exec('BEGIN IMMEDIATE')
    try{
      if(allocation&&budget>previous.budget)this.db.prepare('INSERT INTO allocation_funding VALUES(?,?,?,?)').run(randomUUID(),allocation.id,budget-previous.budget,time)
      this.db.prepare('INSERT INTO style_authorizations VALUES(?,?,?,?,?) ON CONFLICT(user,style) DO UPDATE SET budget=excluded.budget,active=1,consented=excluded.consented').run(user,style,budget,1,time)
      this.db.prepare('UPDATE accounts SET style=?,budget=?,active=1,consented=?,error=NULL WHERE user=?').run(style,budget,time,user)
      this.ensureAllocation(this.account(user,style));this.log(user,'authorization',`${style}; virtual budget $${budget}`);this.db.exec('COMMIT')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
  ensureAllocation(account){
    if(!account||account.budget<=0)return null
    let allocation=this.db.prepare('SELECT * FROM allocations WHERE user=? AND account_id=? AND style=? AND ended IS NULL ORDER BY started DESC LIMIT 1').get(account.user,account.account_id,account.style)
    if(allocation)return allocation
    const time=account.consented??new Date().toISOString()
    const earliest=!allocation?this.db.prepare("SELECT time FROM audit WHERE user=? AND action='authorization' AND detail=? ORDER BY id LIMIT 1").get(account.user,`${account.style}; virtual budget $${account.budget}`)?.time:null
    const id=randomUUID();this.db.prepare('INSERT INTO allocations VALUES(?,?,?,?,?,?,NULL)').run(id,account.user,account.account_id,account.style,account.budget,earliest??time)
    return this.db.prepare('SELECT * FROM allocations WHERE id=?').get(id)
  }
  allocationFills(allocation){return allocation?this.fills(allocation.user,null).filter(f=>f.style===allocation.style&&new Date(f.time)>=new Date(allocation.started)&&(!allocation.ended||new Date(f.time)<new Date(allocation.ended))):[]}
  funding(allocation){return allocation?this.db.prepare('SELECT amount,time FROM allocation_funding WHERE allocation_id=? ORDER BY time,id').all(allocation.id):[]}
  cashAvailable(account,calendar,now){const allocation=this.ensureAllocation(account);if(!allocation)throw new Error('Cash allocation is not authorized.');const funded=allocation.capital+this.funding(allocation).filter(f=>f.time<=now).reduce((sum,f)=>sum+f.amount,0);return allocationCash(funded,this.allocationFills(allocation),calendar,now)}
  reserved(user,style=null,exclude=null){return this.intents(user).filter(i=>i.id!==exclude&&(!style||i.style===style)&&i.kind==='entry'&&(['unknown','submitting'].includes(i.status)||(i.broker&&isOpen(i.broker)))).reduce((sum,i)=>sum+Math.max(0,number(i.body.qty)-number(i.broker?.filled_qty??0))*number(i.body.limit_price),0)}
  observePerformance(user,snapshot){
    for(const account of this.styleAccounts(user)){
    const allocation=this.ensureAllocation(account);if(!allocation)continue
    const fills=this.allocationFills(allocation),lots=new Map();let cash=allocation.capital+this.funding(allocation).filter(f=>f.time<=snapshot.observedAt).reduce((sum,f)=>sum+f.amount,0)
    for(const fill of fills){cash+=(fill.side==='buy'?-1:1)*fill.qty*fill.price;lots.set(fill.symbol,(lots.get(fill.symbol)??0)+(fill.side==='buy'?1:-1)*fill.qty)}
    let value=cash
    for(const [symbol,qty] of lots){if(Math.abs(qty)<1e-8)continue;const held=snapshot.positions?.find(p=>p.symbol===symbol);if(qty<0||!held||!Number.isFinite(Number(held.current_price))){value=NaN;break}value+=qty*Number(held.current_price)}
    if(Number.isFinite(value))this.db.prepare('INSERT INTO performance_points VALUES(?,?,?,?) ON CONFLICT(allocation_id,day) DO UPDATE SET value=excluded.value,observed_at=excluded.observed_at').run(allocation.id,tradingDate(snapshot.observedAt),Math.round(value*100)/100,snapshot.observedAt)
    }
  }
  performance(user,now=new Date().toISOString()){
    const account=this.account(user);if(!account)return {}
    for(const styleAccount of this.styleAccounts(user))this.ensureAllocation(styleAccount);const result={}
    for(const style of ['day','swing','longterm']){
      const allocation=this.db.prepare('SELECT * FROM allocations WHERE user=? AND account_id=? AND style=? ORDER BY started DESC LIMIT 1').get(user,account.account_id,style);if(!allocation)continue
      const observations=this.db.prepare('SELECT day,value,observed_at AS observedAt FROM performance_points WHERE allocation_id=? ORDER BY day').all(allocation.id)
      result[style]=buildPerformance({capital:allocation.capital,started:allocation.started,fills:this.allocationFills(allocation),funding:this.funding(allocation),observations,now:allocation.ended??now})
    }
    return result
  }
  pause(user,reason='Customer paused new entries.',style=null){this.migrateAuthorizations();if(style)this.db.prepare('UPDATE style_authorizations SET active=0 WHERE user=? AND style=?').run(user,style);else this.db.prepare('UPDATE style_authorizations SET active=0 WHERE user=?').run(user);this.db.prepare('UPDATE accounts SET active=EXISTS(SELECT 1 FROM style_authorizations WHERE user=? AND active=1) WHERE user=?').run(user,user);this.log(user,'pause',`${style??'All styles'}: ${reason}`)}
  setting(){return this.db.prepare('SELECT * FROM settings WHERE id=1').get()}
  halt(value){this.db.prepare('UPDATE settings SET halt=? WHERE id=1').run(value?1:0)}
  heartbeat(){this.db.prepare('UPDATE settings SET heartbeat=? WHERE id=1').run(new Date().toISOString())}
  draft(){return JSON.parse(this.db.prepare('SELECT body FROM drafts WHERE id=1').get().body)}
  saveDraft(body,user){this.db.prepare('UPDATE drafts SET body=?,updated=? WHERE id=1').run(JSON.stringify(body),new Date().toISOString());this.log(user,'draft_saved','Owner strategy draft saved.')}
  publish(body,user){const id=randomUUID();this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO releases VALUES(?,?,?,?)').run(id,JSON.stringify(body),user,new Date().toISOString());this.db.prepare('UPDATE settings SET release_id=? WHERE id=1').run(id);this.log(user,'paper_release',id);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}return id}
  release(id=this.setting().release_id){const row=id?this.db.prepare('SELECT * FROM releases WHERE id=?').get(id):null;return row?{...row,body:JSON.parse(row.body)}:null}
  releases(){return this.db.prepare('SELECT id,owner,created FROM releases ORDER BY created DESC LIMIT 30').all()}
  baseline(user,session,equity){this.db.prepare('INSERT OR IGNORE INTO baselines VALUES(?,?,?)').run(user,session,equity);return this.db.prepare('SELECT equity FROM baselines WHERE user=? AND session=?').get(user,session).equity}
  intents(user){return this.db.prepare('SELECT * FROM intents WHERE user=? ORDER BY created').all(user).map(row=>({...row,body:JSON.parse(row.body),broker:row.broker?JSON.parse(row.broker):null}))}
  intent(id){const row=this.db.prepare('SELECT * FROM intents WHERE id=?').get(id);return row?{...row,body:JSON.parse(row.body),broker:row.broker?JSON.parse(row.broker):null}:null}
  prepare({id,user,symbol,style,version,kind,body,reason}) {
    const time=new Date().toISOString()
    return this.db.prepare("INSERT OR IGNORE INTO intents(id,user,symbol,style,version,kind,body,reason,status,created,updated) VALUES(?,?,?,?,?,?,?,?,'submitting',?,?)").run(id,user,symbol,style,version,kind,JSON.stringify(body),reason,time,time).changes===1
  }
  mark(id,status){this.db.prepare('UPDATE intents SET status=?,updated=? WHERE id=?').run(status,new Date().toISOString(),id)}
  recordOrder(id,order,source='Broker cumulative-fill reconciliation') {
    const intent=this.intent(id);if(!intent || !order?.id)return
    if(!Array.isArray(order.legs)&&Array.isArray(intent.broker?.legs))order={...order,legs:intent.broker.legs}
    this.db.exec('BEGIN IMMEDIATE')
    try{
      this.db.prepare('UPDATE intents SET status=?,broker_id=?,broker=?,updated=? WHERE id=?').run(order.status,order.id,JSON.stringify(order),new Date().toISOString(),id)
      for(const item of flattenOrders(order)){
        const qty=number(item.filled_qty??0),price=number(item.filled_avg_price??0),notional=qty*price,old=this.db.prepare('SELECT * FROM observed WHERE order_id=?').get(item.id)??{qty:0,notional:0}
        if(qty<old.qty)throw new Error('Broker cumulative fills decreased. Reconciliation requires review.')
        if(qty>old.qty && price>0 && intent.kind!=='test'){
          const delta=qty-old.qty,fillPrice=(notional-old.notional)/delta
          if(!Number.isFinite(fillPrice)||fillPrice<=0)throw new Error('Fill reconciliation requires review.')
          this.db.prepare('INSERT OR IGNORE INTO fills VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`${item.id}:${qty}`,intent.user,item.symbol??intent.symbol,intent.style,intent.version,item.side,delta,fillPrice,item.filled_at??item.updated_at??new Date().toISOString(),item.id,source)
        }
        if(qty>=old.qty)this.db.prepare('INSERT INTO observed VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET qty=excluded.qty,notional=excluded.notional').run(item.id,qty,notional)
      }
      this.db.exec('COMMIT')
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  fills(user,limit=500){return limit===null?this.db.prepare('SELECT * FROM fills WHERE user=? ORDER BY time').all(user):this.db.prepare('SELECT * FROM fills WHERE user=? ORDER BY time DESC LIMIT ?').all(user,limit)}
  owned(user){
    const positions=new Map()
    for(const intent of this.intents(user).filter(i=>i.kind!=='test'&&i.broker))for(const order of flattenOrders(intent.broker)){
      const qty=number(order.filled_qty??0)*(order.side==='buy'?1:-1),key=intent.style+':'+intent.symbol
      const current=positions.get(key)??{symbol:intent.symbol,qty:0,style:intent.style,version:intent.version,entryId:intent.id}
      current.qty+=qty;positions.set(key,current)
    }
    return [...positions.values()].filter(p=>Math.abs(p.qty)>1e-8)
  }
  log(user,action,detail){this.db.prepare('INSERT INTO audit(user,action,detail,time) VALUES(?,?,?,?)').run(user,action,String(detail).slice(0,2000),new Date().toISOString())}
  audit(user,owner=false){return owner?this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all():this.db.prepare('SELECT * FROM audit WHERE user=? ORDER BY id DESC LIMIT 30').all(user)}
  reserveCycle(id,user){return this.db.prepare("INSERT OR IGNORE INTO cycles VALUES(?,?,'started',?)").run(id,user,new Date().toISOString()).changes===1}
  universe(){const row=this.db.prepare('SELECT body FROM universe WHERE id=1').get();return row?JSON.parse(row.body):null}
  saveUniverse(snapshot){this.db.prepare('INSERT INTO universe VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(snapshot))}
  close(){this.db.close()}
}
