import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('only an administrator can rotate enrollment codes; signup cannot bypass invitations or choose a role',async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});const path='.sites-runtime/tests/invitations.mjs';
  await build({entryPoints:['tests/app-worker.ts'],outfile:path,bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
  const mf=new Miniflare({modules:[{type:'ESModule',path,contents:await readFile(path,'utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{BETTER_AUTH_URL:'https://test.local',BETTER_AUTH_SECRET:'testing-secret-with-at-least-32-characters',CLASS_INVITE_CODE:'legacy-invite'}});
  try{
    const db=await mf.getD1Database('DB');for(const f of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+f,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
    const call=(path,method='GET',cookie='',body)=>mf.dispatchFetch('https://test.local'+path,{method,headers:{origin:'https://test.local','content-type':'application/json',cookie,'cf-connecting-ip':'192.0.2.1'},body:body===undefined?undefined:JSON.stringify(body)});
    const signup=async(username,inviteCode='legacy-invite')=>{await db.prepare('DELETE FROM rateLimit').run();return call('/api/auth/sign-up/email','POST','',{username,name:username,email:'pending@example.invalid',password:'testing-password-2026',inviteCode,role:'admin',classId:'foreign'});};
    const auth=await signup('invite_owner');assert.equal(auth.status,200);const cookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    assert.equal((await call('/api/admin/invitation','POST','',{})).status,401);
    assert.equal((await call('/api/admin/invitation','POST',cookie,{})).status,403);
    const owner=await db.prepare("SELECT id,role,classId FROM user WHERE username='invite_owner'").first();assert.equal(owner.role,'member');assert.equal(owner.classId,'prototype');
    assert.equal((await call('/api/auth/update-user','POST',cookie,{role:'admin'})).status,403);
    await db.prepare("UPDATE user SET role='admin' WHERE id=?").bind(owner.id).run();
    assert.equal((await call('/api/app','GET',cookie)).status,200);
    const initial=await call('/api/admin/invitation','POST',cookie,{});assert.equal(initial.status,200);const first=await initial.json();assert.ok(first.code.length>=16);
    const stored=await db.prepare("SELECT code_hash FROM class_invitations WHERE class_id='prototype'").first();assert.notEqual(stored.code_hash,first.code);
    const info=await call('/api/admin/invitation','GET',cookie);assert.equal(info.status,200);assert.ok(!JSON.stringify(await info.json()).includes(first.code));
    assert.equal((await signup('legacy_blocked')).status,403);assert.equal((await signup('missing_code',null)).status,403);
    const invited=await signup('invited_member',first.code);assert.equal(invited.status,200);
    const memberCookie=invited.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.equal((await call('/api/admin/invitation','GET',memberCookie)).status,403);
    const second=await (await call('/api/admin/invitation','POST',cookie,{})).json();assert.notEqual(second.code,first.code);
    assert.equal((await signup('old_code',first.code)).status,403);assert.equal((await signup('new_code',second.code)).status,200);
    await db.prepare("UPDATE user SET role='member' WHERE id=?").bind(owner.id).run();assert.equal((await call('/api/admin/invitation','POST',cookie,{})).status,403);
    await db.prepare('DROP TABLE class_invitations').run();assert.notEqual((await signup('db_unavailable')).status,200,'missing invitation storage never falls back to the legacy code');
  }finally{await mf.dispose();}
});
