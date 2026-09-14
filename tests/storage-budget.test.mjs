import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('storage gates concurrent capacity, operation limits, uncertain failures and emergency stop before R2',async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  await build({entryPoints:['tests/storage-worker.ts'],outfile:'.sites-runtime/tests/storage-budget.mjs',bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
  const mf=new Miniflare({modules:[{type:'ESModule',path:'.sites-runtime/tests/storage-budget.mjs',contents:await readFile('.sites-runtime/tests/storage-budget.mjs','utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB']});
  try {
    const db=await mf.getD1Database('DB');
    for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort()) for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim())) await db.prepare(sql).run();
    const call=(op,key='file',fail=false,epoch='current-generation')=>mf.dispatchFetch('https://test.local/',{method:'POST',body:JSON.stringify({op,key,fail,epoch})});
    const stats=async()=>await (await mf.dispatchFetch('https://test.local/')).json();
    const budget=()=>db.prepare('SELECT * FROM storage_budget').first();
    const reset=async()=>{await db.prepare('DELETE FROM storage_reservations').run();await db.prepare("UPDATE storage_budget SET enabled=1,epoch='current-generation',reserved_bytes=0,writes_today=0,reads_today=0,day=strftime('%Y-%m-%d','now')").run();};
    for(const op of ['put','get','delete']) assert.equal((await call(op)).status,503);
    assert.deepEqual(await stats(),{puts:0,gets:0,deletes:0});
    await reset();
    const {day:uploadDay}=await db.prepare('SELECT CAST(unixepoch()/86400 AS INTEGER) AS day').first();
    for(const day of [uploadDay-1,uploadDay+1]){
      const before=await stats();
      const crossed=await mf.dispatchFetch('https://test.local/',{method:'POST',body:JSON.stringify({op:'put',key:'crossed-day',epoch:'current-generation',uploadDay:day})});
      assert.equal(crossed.status,409,'a different admission day must not reach R2');
      assert.deepEqual(await stats(),before);assert.equal((await budget()).reserved_bytes,0);
    }
    // Restoring an enabled DB must not override the stop value outside D1.
    for (const epoch of ['', 'restored-old-generation']) {
      const before=await stats();
      for(const op of ['put','get','delete']) assert.equal((await call(op,'restored',false,epoch)).status,503,'restored DB');
      assert.deepEqual(await stats(),before);
    }
    // A partially restored schema must never allow an unmetered object write.
    for (const name of ['storage_reserve_before','storage_reserve_after','storage_release']) {
      const {sql}=await db.prepare('SELECT sql FROM sqlite_master WHERE name=?').bind(name).first();
      await db.prepare(`DROP TRIGGER ${name}`).run();
      const before=await stats();
      for(const op of ['put','get','delete']) assert.equal((await call(op,'missing-trigger')).status,503,`${name}: ${op}`);
      assert.deepEqual(await stats(),before);
      await db.prepare(sql).run();
    }
    const original=await db.prepare("SELECT sql FROM sqlite_master WHERE name='storage_reserve_after'").first();
    await db.prepare('DROP TRIGGER storage_reserve_after').run();
    await db.prepare('CREATE TRIGGER storage_reserve_after AFTER INSERT ON storage_reservations BEGIN SELECT 1; END').run();
    assert.equal((await call('put','wrong-definition')).status,503,'a matching trigger name is insufficient');
    await db.prepare('DROP TRIGGER storage_reserve_after').run();
    await db.prepare(original.sql).run();
    await db.prepare('UPDATE storage_budget SET reserved_bytes=4999999980').run();
    const uploads=await Promise.all([call('put','a'),call('put','b')]);
    assert.deepEqual(uploads.map(r=>r.status).sort(),[200,503]);
    assert.equal((await budget()).reserved_bytes,5000000000);
    assert.equal((await budget()).writes_today,1);
    assert.equal((await stats()).puts,1);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM storage_reservations').first()).n,1);
    await reset();
    await db.prepare('UPDATE storage_budget SET writes_today=299').run();
    const writes=await Promise.all([call('put','c'),call('put','d')]);
    assert.deepEqual(writes.map(r=>r.status).sort(),[200,503]);
    assert.equal((await budget()).writes_today,300);
    assert.equal((await call('delete','c')).status,200,'upload quota must leave deletion available');
    assert.equal((await budget()).writes_today,300,'deletion has its own quota');
    await db.prepare('UPDATE storage_budget SET reads_today=2999').run();
    const reads=await Promise.all([call('get'),call('get')]);
    assert.deepEqual(reads.map(r=>r.status).sort(),[200,503]);
    assert.equal((await budget()).reads_today,3000);
    assert.equal((await stats()).gets,1);
    await reset();
    assert.equal((await call('put','uncertain',true)).status,500);
    assert.equal((await budget()).reserved_bytes,20);
    assert.equal((await budget()).writes_today,1);
    assert.equal((await call('delete','uncertain',true)).status,500);
    assert.equal((await budget()).reserved_bytes,20);
    assert.equal((await budget()).writes_today,1);
    const removed=await Promise.all([call('delete','uncertain'),call('delete','uncertain')]);
    assert.ok(removed.every(r=>r.status===200));
    assert.equal((await budget()).reserved_bytes,0);
    assert.equal((await budget()).writes_today,1);
    assert.equal((await call('get','file',true)).status,500);
    assert.equal((await budget()).reads_today,1);
    for(const committed of [false,true]){
      await reset();await call('put','cleanup');const beforeDelete=await stats();
      const removed=await mf.dispatchFetch('https://test.local/',{method:'POST',body:JSON.stringify({op:'delete',key:'cleanup',epoch:'current-generation',cleanupFailures:1,committed})});
      assert.equal(removed.status,200,'a transient cleanup failure recovers');
      assert.equal((await budget()).reserved_bytes,0,'capacity is refunded exactly once');
      assert.equal((await stats()).deletes,beforeDelete.deletes+1,'R2 is never retried automatically');
    }
    await reset();await call('put','persistent');
    const persistent=await mf.dispatchFetch('https://test.local/',{method:'POST',body:JSON.stringify({op:'delete',key:'persistent',epoch:'current-generation',cleanupFailures:2})});
    assert.equal(persistent.status,503);assert.equal((await budget()).reserved_bytes,20);
    assert.equal((await call('delete','persistent')).status,200);assert.equal((await budget()).reserved_bytes,0);
    await db.prepare("UPDATE storage_budget SET day=strftime('%Y-%m-%d','now','-1 day'),writes_today=300,reads_today=3000").run();
    assert.equal((await call('get')).status,200);
    assert.equal((await budget()).reads_today,1);
    assert.equal((await budget()).writes_today,0);
    await db.prepare("INSERT INTO storage_operation_limits(key,window,count) VALUES('global:delete',unixepoch()/86400,299) ON CONFLICT(key) DO UPDATE SET count=299").run();
    const deletions=await Promise.all([call('delete','x'),call('delete','y')]);
    assert.deepEqual(deletions.map(r=>r.status).sort(),[200,503],'deletions also have a bounded quota');
    const before=await stats();
    await db.prepare("UPDATE storage_budget SET day=strftime('%Y-%m-%d','now','+1 day')").run();
    for(const op of ['put','get','delete']) assert.equal((await call(op)).status,503);
    assert.deepEqual(await stats(),before);
    await reset();
    await db.prepare('UPDATE storage_budget SET enabled=0').run();
    for(const op of ['put','get','delete']) assert.equal((await call(op)).status,503);
    assert.deepEqual(await stats(),before);
    await db.prepare('DROP TABLE storage_budget').run();
    for(const op of ['put','get','delete']) assert.equal((await call(op)).status,503);
    assert.deepEqual(await stats(),before);
  } finally {await mf.dispose();}
});
