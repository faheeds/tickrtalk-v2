// Ephemeral SQLite is a calculation workspace. PostgreSQL is the durable source.
export const checkpointTables=['accounts','drafts','releases','settings','intents','observed','fills','baselines','audit','cycles','allocations','performance_points','universe','style_authorizations','allocation_funding']
export function exportCheckpoint(store){store.migrateAuthorizations();return {version:2,tables:Object.fromEntries(checkpointTables.map(name=>[name,store.db.prepare(`SELECT * FROM ${name}`).all()]))}}
export function importCheckpoint(store,checkpoint){
 if(![1,2].includes(checkpoint?.version)||!checkpoint.tables||typeof checkpoint.tables!=='object')throw new Error('Invalid paper checkpoint.')
 if(!Object.keys(checkpoint.tables).length)return
 if(checkpointTables.some(name=>!Array.isArray(checkpoint.tables[name])&&name!=='universe'&&!(checkpoint.version===1&&['style_authorizations','allocation_funding'].includes(name))))throw new Error('Paper checkpoint is incomplete.')
 store.db.exec('BEGIN IMMEDIATE')
 try{
  for(const name of checkpointTables){
   store.db.exec(`DELETE FROM ${name}`)
   const columns=store.db.prepare(`PRAGMA table_info(${name})`).all().map(c=>c.name)
   const insert=store.db.prepare(`INSERT INTO ${name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`)
   for(const row of checkpoint.tables[name]??[]){if(Object.keys(row).some(k=>!columns.includes(k)))throw new Error('Unrecognized paper checkpoint column.');insert.run(...columns.map(key=>row[key]??null))}
  }
  // A killed request may have posted the order. Reconcile by its stable ID first.
  store.db.prepare("UPDATE intents SET status='unknown' WHERE status='submitting'").run()
  store.migrateAuthorizations()
  store.db.exec('COMMIT')
 }catch(error){store.db.exec('ROLLBACK');throw error}
}
export function migrateOwner(checkpoint,from,to){
 if(!/^user_[A-Za-z0-9]+$/.test(to))throw new Error('A verified Clerk owner ID is required.')
 const result=structuredClone(checkpoint)
 for(const rows of Object.values(result.tables))for(const row of rows){if(row.user===from)row.user=to;if(row.owner===from)row.owner=to}
 return result
}
