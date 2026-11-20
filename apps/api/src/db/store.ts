import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RunResult } from '@repo/shared';
import { json } from '@repo/lab';

export class Conflict extends Error {}
export interface Governance {
  id:string;owner:string;to:string;data:string;action:string;createdAt:string;
  status:'PREPARED'|'CONFIRMED'|'CANCELLED';hash?:string;
  fingerprint:string;
  receiptStatus?:'success'|'reverted';
}
export class Store {
  db:DatabaseSync;
  constructor(path:string) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    this.db.exec(readFileSync(new URL('./migrations/001-initial.sql',import.meta.url),'utf8'));
  }
  atomic<T>(action:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const value=action();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  save(run:RunResult) {
    this.atomic(()=>{
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,payload=excluded.payload').run(run.id,run.status,run.createdAt,json(run));
      for(const [table,rows] of [['run_steps',run.steps],['assertions',run.assertions],['transaction_evidence',run.transactions]] as const) {
        this.db.prepare(`DELETE FROM ${table} WHERE run_id=?`).run(run.id);
        const stmt=this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`);rows.forEach((r,i)=>stmt.run(run.id,i,json(r)));
      }
    });
  }
  get(id:string):RunResult|undefined {const row=this.db.prepare('SELECT payload FROM runs WHERE id=?').get(id);return row?JSON.parse(String(row.payload)):undefined;}
  list(limit=50):RunResult[] {return this.db.prepare('SELECT payload FROM runs ORDER BY created_at DESC,id DESC LIMIT ?').all(limit).map(r=>JSON.parse(String(r.payload)));}
  queued():RunResult[] {return this.db.prepare("SELECT payload FROM runs WHERE status='QUEUED' ORDER BY rowid").all().map(r=>JSON.parse(String(r.payload)));}
  running():RunResult[] {return this.db.prepare("SELECT payload FROM runs WHERE status='RUNNING'").all().map(r=>JSON.parse(String(r.payload)));}
  createRequest(key:string,fingerprint:string,runs:RunResult[]):string[] {
    return this.atomic(()=>{
      const existing=this.db.prepare('SELECT fingerprint,run_ids FROM requests WHERE key=?').get(key);
      if(existing) {if(existing.fingerprint!==fingerprint)throw new Conflict('Idempotency key đã dùng cho nội dung khác.');return JSON.parse(String(existing.run_ids));}
      if(this.queued().length+runs.length>100)throw new Conflict('Hàng đợi đã đầy.');
      for(const run of runs)this.db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run(run.id,run.status,run.createdAt,json(run));
      const ids=runs.map(r=>r.id);this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(key,fingerprint,json(ids));return ids;
    });
  }
  lock(key:string,owner:string):boolean {return this.db.prepare('INSERT OR IGNORE INTO locks VALUES(?,?,?)').run(key,owner,process.pid).changes===1;}
  unlock(key:string,owner:string) {this.db.prepare('DELETE FROM locks WHERE key=? AND owner=?').run(key,owner);}
  lockOwner(key:string):string|undefined {return this.db.prepare('SELECT owner FROM locks WHERE key=?').get(key)?.owner as string|undefined;}
  claimInstance(owner:string) {
    this.atomic(()=>{
      const row=this.db.prepare("SELECT * FROM locks WHERE key='instance'").get();
      if(row) {let alive=true;try{process.kill(Number(row.pid),0);}catch{alive=false;}if(alive)throw new Conflict('API khác đang dùng SQLite này.');this.db.prepare("DELETE FROM locks WHERE key='instance'").run();}
      this.lock('instance',owner);
    });
  }
  targets():number[] {const row=this.db.prepare("SELECT value FROM settings WHERE key='targets'").get();return row?JSON.parse(String(row.value)):[2000,3000,5000];}
  setTargets(values:number[]) {this.db.prepare("INSERT INTO settings VALUES('targets',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(json(values));}
  saveGovernance(g:Governance){this.db.prepare('INSERT INTO governance VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(g.id,json(g));}
  getGovernance(id:string):Governance|undefined {const row=this.db.prepare('SELECT payload FROM governance WHERE id=?').get(id);return row?JSON.parse(String(row.payload)):undefined;}
  pendingGovernance():Governance[] {return this.db.prepare('SELECT payload FROM governance').all().map(r=>JSON.parse(String(r.payload))).filter(g=>g.status==='PREPARED');}
  close(){this.db.close();}
}
