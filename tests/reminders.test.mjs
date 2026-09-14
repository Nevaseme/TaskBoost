import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import webpush from 'web-push';
import {createECDH,randomBytes,randomUUID} from 'node:crypto';

test('reminders merge same-minute conditions, reject unauthorized changes and skip stale or submitted plans',async()=>{
 await mkdir('.sites-runtime/tests',{recursive:true});
 await build({entryPoints:['tests/app-worker.ts'],outfile:'.sites-runtime/tests/reminders.mjs',bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
 const keys=webpush.generateVAPIDKeys(),secret='reminder-test-secret-more-than-32-characters';let sends=0;
 const mf=new Miniflare({modules:[{type:'ESModule',path:'.sites-runtime/tests/reminders.mjs',contents:await readFile('.sites-runtime/tests/reminders.mjs','utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{BETTER_AUTH_URL:'https://test.local',BETTER_AUTH_SECRET:secret,CLASS_INVITE_CODE:'test-invite',CRON_SECRET:secret,VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey,VAPID_SUBJECT:'https://example.com'},outboundService:async()=>{sends++;return new Response(null,{status:201});}});
 try{
  const db=await mf.getD1Database('DB');for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
  const call=(path,body,cookie='',method=body?'POST':'GET')=>mf.dispatchFetch('https://test.local'+path,{method,headers:{origin:'https://test.local','content-type':'application/json',cookie,'cf-connecting-ip':'192.0.2.12'},...(body?{body:JSON.stringify(body)}:{})});
  const signup=async username=>{const r=await call('/api/auth/sign-up/email',{name:username,username,password:'test-password-for-prototype',email:'unused@example.com',inviteCode:'test-invite'});assert.equal(r.status,200,await r.clone().text());await db.prepare('DELETE FROM rateLimit').run();return r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');};
  const ac=await signup('reminder_a'),bc=await signup('reminder_b');
  const a=(await (await call('/api/app',null,ac)).json()).user,b=(await (await call('/api/app',null,bc)).json()).user;
  const task=await call('/api/app/assignments',{subject:'検証',title:'時刻通知',description:'',deadline:new Date(Date.now()+7200000).toISOString()},ac);const {id}=await task.json();
  const path='/api/reminders/'+id,minute=new Date(Math.floor(Date.now()/60000)*60000-60000).toISOString(),old=new Date(Date.parse(minute)-600000).toISOString();
  assert.equal((await call(path)).status,401);
  assert.deepEqual(await (await call(path,null,ac)).json(),{customAt:null,deadlineEnabled:false});
  const future=new Date(Date.now()+600000).toISOString();
  assert.equal((await call(path,{customAt:future,deadlineEnabled:true,userId:b.id},ac,'PUT')).status,400);
  assert.equal((await call(path,{customAt:minute,deadlineEnabled:true},ac,'PUT')).status,400);
  assert.equal((await call(path,{customAt:future,deadlineEnabled:true},ac,'PUT')).status,200);
  assert.deepEqual(await (await call(path,null,bc)).json(),{customAt:null,deadlineEnabled:false});
  const receiver=createECDH('prime256v1');receiver.generateKeys();
  assert.equal((await call('/api/push',{label:'test',subscription:{endpoint:'https://web.push.apple.com/reminders-test',keys:{p256dh:receiver.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}},ac)).status,201);
  const tick=()=>mf.dispatchFetch('https://test.local/api/internal/reminders/tick',{method:'POST',headers:{authorization:'Bearer '+secret,'x-run-id':randomUUID()}});
  assert.equal((await mf.dispatchFetch('https://test.local/api/internal/reminders/tick',{method:'POST'})).status,401);
  const seed=async(custom=minute,deadline=1)=>{await db.prepare('UPDATE reminder_settings SET custom_at=?,deadline_enabled=?,updated_at=? WHERE assignment_id=?').bind(custom,deadline,old,id).run();await db.prepare('UPDATE assignments SET deadline=? WHERE id=?').bind(new Date(Date.parse(minute)+3600000).toISOString(),id).run();};
  await seed();const results=await Promise.all([tick(),tick()]);for(const r of results)assert.equal(r.status,200,await r.clone().text());
  assert.equal(sends,1);let notes=(await (await call('/api/app',null,ac)).json()).notifications;assert.equal(notes.length,1);assert.deepEqual(notes[0].reasons.split(',').sort(),['reminder_custom','reminder_deadline']);
  await tick();assert.equal(sends,1);
  // A new minute is eligible only while unsubmitted; cancellation never resends the past.
  const nextMinute=new Date(Date.parse(minute)-60000).toISOString();await seed(nextMinute,0);
  await db.prepare('INSERT INTO submissions(assignment_id,user_id,submitted,updated_at,operation_id) VALUES(?,?,1,?,?)').bind(id,a.id,old,randomUUID()).run();await tick();assert.equal(sends,1);
  await db.prepare('UPDATE submissions SET submitted=0,updated_at=? WHERE assignment_id=?').bind(new Date().toISOString(),id).run();await tick();assert.equal(sends,1);
  await db.prepare('DELETE FROM submissions WHERE assignment_id=?').bind(id).run();await seed(null,0);await tick();assert.equal(sends,1);
  await seed(new Date(Date.now()-6*60000).toISOString(),0);await tick();assert.equal(sends,1);
  // Changing the deadline moves only the one-hour reminder; the custom instant stays fixed.
  await seed(nextMinute,1);await db.prepare('UPDATE assignments SET deadline=? WHERE id=?').bind(new Date(Date.now()+7200000).toISOString(),id).run();await tick();assert.equal(sends,2);
  notes=(await (await call('/api/app',null,ac)).json()).notifications;assert.ok(notes.some(n=>n.reasons==='reminder_custom'));
  // Switching away from the account detaches its device before later reminders.
  await call('/api/auth/sign-out',{},ac);await seed(new Date(Date.parse(minute)-120000).toISOString(),0);await tick();assert.equal(sends,2);
  await db.prepare('UPDATE user SET classId=? WHERE id=?').bind('other-class',b.id).run();assert.equal((await call(path,null,bc)).status,404);
 }finally{await mf.dispose();}
});
