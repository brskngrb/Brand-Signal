import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
export function clearCollectedData(projectRoot){
 const directory=resolve(projectRoot,'data','backups',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
 const db=new DatabaseSync(resolve(projectRoot,'data/web-knowledge.sqlite'));
 try{
  db.prepare('ATTACH DATABASE ? AS knowledge').run(resolve(projectRoot,'data/product-knowledge.sqlite'));
  db.prepare('VACUUM main INTO ?').run(resolve(directory,'web-knowledge.sqlite'));
  db.prepare('VACUUM knowledge INTO ?').run(resolve(directory,'product-knowledge.sqlite'));
  db.exec('BEGIN IMMEDIATE');
  try{for(const table of ['web_pages','crawl_runs','keyword_snapshots'])db.exec(`DELETE FROM main.${table}`);for(const table of ['facts','evidence','reports','jobs'])db.exec(`DELETE FROM knowledge.${table}`);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  return {ok:true,backup:directory};
 }finally{db.close()}
}
