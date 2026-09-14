import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {test} from 'node:test';

test('deletion failures preserve task data and allow explicit recovery',async()=>{
const root=path.resolve('dist/pages/_worker.js');
const names=['index.js',...(await readdir(root,{recursive:true})).filter(f=>f.endsWith('.js')&&f!=='index.js')];
const modules=await Promise.all(names.map(async name=>({type:'ESModule',path:path.join(root,name),contents:await readFile(path.join(root,name),'utf8')})));
const mf=new Miniflare({modules,modulesRoot:root,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB','STORAGE_DB'],r2Buckets:['BUCKET'],bindings:{BETTER_AUTH_URL:'https://test.local',BETTER_AUTH_SECRET:'local-test-secret-at-least-thirty-two-characters',CLASS_INVITE_CODE:'local-deletion-check',STORAGE_EPOCH:'local-test'}});
try{
 const db=await mf.getD1Database('DB'),storage=await mf.getD1Database('STORAGE_DB'),bucket=await mf.getR2Bucket('BUCKET');
 for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 for(const sql of (await readFile('deployment/storage/0000_storage.sql','utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await storage.prepare(sql).run();
 await storage.prepare("UPDATE storage_budget SET enabled=1,epoch='local-test' WHERE id=1").run();
 const call=(route,method='GET',cookie='',body,headers={})=>mf.dispatchFetch('https://test.local'+route,{method,headers:{origin:'https://test.local',cookie,'content-type':'application/json','cf-connecting-ip':'192.0.2.3',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const auth=await call('/api/auth/sign-up/email','POST','',{username:'deletion_test',name:'確認用',email:'pending@example.invalid',password:'local-testing-password',inviteCode:'local-deletion-check'});assert.equal(auth.status,200,await auth.clone().text());
 const cookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const made=await call('/api/app/assignments','POST',cookie,{title:'削除確認',subject:'確認',description:'',deadline:'2026-12-01T00:00:00.000Z'});assert.equal(made.status,201);const id=(await made.json()).id,url='/api/app/assignments/'+id;
 await call(url+'/submission','PUT',cookie,{submitted:true});
 await call('/api/reminders/'+id,'PUT',cookie,{customAt:null,deadlineEnabled:true});
 const pdf=await readFile('tests/fixtures/connectivity.pdf');
 for(let n=0;n<2;n++){const upload=await mf.dispatchFetch('https://test.local/api/files/'+id,{method:'POST',headers:{origin:'https://test.local',cookie,'x-file-name':'test.pdf'},body:pdf});assert.equal(upload.status,201);}
 await storage.prepare("INSERT INTO storage_operation_limits(key,window,count) VALUES('global:delete',unixepoch()/86400,299)").run();
 assert.equal((await call(url,'DELETE',cookie)).status,503);
 assert.equal((await bucket.list()).objects.length,1);
 assert.equal((await storage.prepare('SELECT reserved_bytes FROM storage_budget').first()).reserved_bytes,pdf.length);
 for(const table of ['assignments','submissions','reminder_settings'])assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,1);
 await storage.prepare("UPDATE storage_operation_limits SET count=299 WHERE key='global:delete'").run();
 await db.prepare("CREATE TRIGGER deletion_failure BEFORE DELETE ON assignments BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
 assert.equal((await call(url,'DELETE',cookie)).status,409);
 for(const table of ['assignments','submissions','reminder_settings'])assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,1);
 assert.equal((await bucket.list()).objects.length,0);
 assert.equal((await storage.prepare('SELECT reserved_bytes FROM storage_budget').first()).reserved_bytes,0);
 await db.prepare('DROP TRIGGER deletion_failure').run();
 assert.equal((await call(url,'DELETE',cookie)).status,200);
 for(const table of ['assignments','submissions','reminder_settings'])assert.equal((await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n,0);

}finally{await mf.dispose();}

});
