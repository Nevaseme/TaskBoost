import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('attachments preserve bytes, enforce class/creator rights, size and concurrent five-file cap', async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  await build({entryPoints:['tests/app-worker.ts'],outfile:'.sites-runtime/tests/files.mjs',bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
  const mf=new Miniflare({modules:[{type:'ESModule',path:'.sites-runtime/tests/files.mjs',contents:await readFile('.sites-runtime/tests/files.mjs','utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB','STORAGE_DB'],r2Buckets:['BUCKET'],bindings:{STORAGE_EPOCH:'current-generation',BETTER_AUTH_URL:'https://test.local',BETTER_AUTH_SECRET:'testing-secret-with-at-least-32-characters',CLASS_INVITE_CODE:'test-invite'}});
  try{
    const db=await mf.getD1Database('DB'), storageDb=await mf.getD1Database('STORAGE_DB');
    for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()) for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
    for(const sql of (await readFile('deployment/storage/0000_storage.sql','utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await storageDb.prepare(sql).run();
    await storageDb.prepare("UPDATE storage_budget SET enabled=1,epoch='current-generation' WHERE id=1").run();
    const call=(path,method='GET',cookie='',body,headers={})=>mf.dispatchFetch('https://test.local'+path,{method,headers:{origin:'https://test.local',cookie,...headers},body});
    const signup=async username=>{const r=await call('/api/auth/sign-up/email','POST','',JSON.stringify({name:username,username,email:'placeholder@example.com',password:'prototype-password',inviteCode:'test-invite'}),{'content-type':'application/json'});assert.equal(r.status,200);await db.prepare('DELETE FROM rateLimit').run();return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');};
    const a=await signup('files_a'),b=await signup('files_b'),c=await signup('files_c');
    await db.prepare("UPDATE user SET classId='other' WHERE username='files_c'").run();
    const r=await call('/api/app/assignments','POST',a,JSON.stringify({subject:'英語',title:'添付検証',description:'',deadline:'2026-10-01T00:00:00.000Z'}),{'content-type':'application/json'});
    const id=(await r.json()).id,path='/api/files/'+id,pdf=await readFile('tests/fixtures/connectivity.pdf');
    const upload=(bytes,cookie=a,name='資料.pdf')=>call(path,'POST',cookie,bytes,{'x-file-name':encodeURIComponent(name)});
    assert.equal((await upload(pdf,b)).status,403);
    assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',c)).status,404);
    assert.equal((await upload(Buffer.from('fake'))).status,415);
    assert.equal((await upload(Buffer.from('a'),a,'broken.docx')).status,415);
    const created=await upload(pdf);assert.equal(created.status,201,await created.clone().text());const file=await created.json();
    const get=await call(path+'/'+file.id,'GET',b);assert.equal(get.status,200);
    assert.equal(createHash('sha256').update(Buffer.from(await get.arrayBuffer())).digest('hex'),createHash('sha256').update(pdf).digest('hex'));
    assert.equal((await call(path+'/'+file.id,'GET',c)).status,404);assert.equal((await call(path+'/'+file.id,'GET')).status,401);
    assert.equal((await call(path+'/'+file.id,'DELETE',b)).status,403);
    await call(path+'/'+file.id,'DELETE',a);
    for(const size of [20*1024*1024-1,20*1024*1024,20*1024*1024+1]){
      const data=Buffer.alloc(size,32);pdf.copy(data);const r=await upload(data);assert.equal(r.status,size>20*1024*1024?413:201,await r.clone().text());
      if(r.status===201){const f=await r.json();const got=await call(path+'/'+f.id,'GET',b);assert.equal(createHash('sha256').update(Buffer.from(await got.arrayBuffer())).digest('hex'),f.sha256);await call(path+'/'+f.id,'DELETE',a);}
    }
    const batch=await Promise.all(Array.from({length:6},()=>upload(pdf)));
    assert.ok(batch.some(r=>r.status===201));assert.ok(batch.every(r=>[201,429].includes(r.status)),'overlapping buffered uploads are refused');
    let savedCount=(await db.prepare('SELECT count(*) AS n FROM assignment_files').first()).n;
    while(savedCount++<5)assert.equal((await upload(pdf)).status,201);
    assert.equal((await upload(pdf)).status,409,'the five-file limit remains enforced');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM assignment_files').first()).n,5);
    assert.equal((await (await mf.getR2Bucket('BUCKET')).list()).objects.length,5);
    const member=await db.prepare("SELECT id FROM user WHERE username='files_b'").first();
    const saved=await db.prepare('SELECT id FROM assignment_files LIMIT 1').first();
    await storageDb.prepare("INSERT INTO storage_operation_limits(key,window,count) VALUES(?,unixepoch()/86400,199) ON CONFLICT(key) DO UPDATE SET count=199").bind(`user:${member.id}:read`).run();
    const before=(await storageDb.prepare('SELECT reads_today FROM storage_budget').first()).reads_today;
    const limited=await Promise.all([call(path+'/'+saved.id,'GET',b),call(path+'/'+saved.id,'GET',b)]);
    assert.deepEqual(limited.map(r=>r.status).sort(),[200,429],'one member cannot consume the class read budget');
    assert.equal((await storageDb.prepare('SELECT reads_today FROM storage_budget').first()).reads_today,before+1);
    assert.equal((await call(path+'/'+saved.id,'GET',a)).status,200,'another member keeps access');
    const ledgerBefore=await storageDb.prepare('SELECT * FROM storage_budget').first();
    // Simulate the dangerous portion of an older app DB restore: enabled and
    // usage counters rolled back while R2 retains all newer file objects.
    await db.prepare("UPDATE storage_budget SET enabled=1,epoch='current-generation',reserved_bytes=0,writes_today=0,reads_today=0").run();
    await db.prepare('DELETE FROM storage_operation_limits').run();
    assert.equal((await call(path+'/'+saved.id,'GET',b)).status,429,'app DB restore cannot replenish quota');
    assert.deepEqual(await storageDb.prepare('SELECT * FROM storage_budget').first(),ledgerBefore);
    const owner=await db.prepare("SELECT id FROM user WHERE username='files_a'").first();
    await storageDb.prepare("INSERT INTO storage_operation_limits(key,window,count) VALUES(?,unixepoch()/60,29) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=29").bind(`user:${owner.id}:minute`).run();
    const burst=await Promise.all([call(path+'/'+saved.id,'GET',a),call(path+'/'+saved.id,'GET',a)]);
    assert.deepEqual(burst.map(r=>r.status).sort(),[200,429],'concurrent requests respect the per-minute cap');
    const beforeMissingTable=await storageDb.prepare('SELECT * FROM storage_budget').first();
    await storageDb.prepare('DROP TABLE storage_operation_limits').run();
    assert.equal((await upload(pdf)).status,503);
    assert.equal((await call(path+'/'+saved.id,'GET',a)).status,503);
    assert.equal((await call(path+'/'+saved.id,'DELETE',a)).status,503);
    assert.deepEqual(await storageDb.prepare('SELECT * FROM storage_budget').first(),beforeMissingTable);
    assert.equal((await (await mf.getR2Bucket('BUCKET')).list()).objects.length,5);
  }finally{await mf.dispose();}
});

