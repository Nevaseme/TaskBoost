import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir,mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
test('AI drafts require login, preserve unknown time, bound input and stop on free quota',async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  await build({entryPoints:['tests/app-worker.ts'],outfile:'.sites-runtime/tests/ai.mjs',bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
  let mode='ok',calls=0;
  const mf=new Miniflare({modules:[{type:'ESModule',path:'.sites-runtime/tests/ai.mjs',contents:await readFile('.sites-runtime/tests/ai.mjs','utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{BETTER_AUTH_URL:'https://test.local',BETTER_AUTH_SECRET:'testing-secret-with-at-least-32-characters',CLASS_INVITE_CODE:'test-invite',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),WORKERS_AI_API_TOKEN:'test-token'},outboundService:async request=>{
    calls++;
    if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1000));
    if(mode==='quota')return Response.json({success:false,errors:[{code:3036}]},{status:429});
    if(mode==='conversion_failure')return Response.json({success:true,result:[{format:'error',data:''}]});
    if(request.url.endsWith('/tomarkdown'))return Response.json({success:true,result:[{data:mode==='long'?'x'.repeat(20001):'英語 教科書12ページ',tokens:10}]});
    const body=await request.json();assert.ok(body.messages[1].content);
    return Response.json({choices:[{message:{content:JSON.stringify({subject:'数学',title:'問題集',description:'問1を解く',submissionFormat:'紙',deadlineDate:'2026-09-18',deadlineTime:''})}}],usage:{total_tokens:50,neurons:1}});
  }});
  try{
    const db=await mf.getD1Database('DB');for(const file of (await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort())for(const sql of (await readFile('drizzle/'+file,'utf8')).split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
    const signup=await mf.dispatchFetch('https://test.local/api/auth/sign-up/email',{method:'POST',headers:{origin:'https://test.local','content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify({name:'AI検証',username:'ai_test',email:'placeholder@example.com',password:'prototype-password',inviteCode:'test-invite'})});assert.equal(signup.status,200);
    const cookie=signup.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
    const png=await readFile('tests/fixtures/connectivity.png'),pdf=await readFile('tests/fixtures/connectivity.pdf');
    const call=(data=png,name='print.png',auth=cookie)=>mf.dispatchFetch('https://test.local/api/ai/draft',{method:'POST',headers:{origin:'https://test.local',cookie:auth,'x-file-name':name},body:data});
    assert.equal((await call(png,'print.png','')).status,401);assert.equal(calls,0);
    const r=await call();assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).draft.deadlineTime,'');
    const oversized=Buffer.from(png);oversized.writeUInt32BE(3000,16);assert.equal((await call(oversized)).status,413);
    mode='long';assert.equal((await call(pdf,'print.pdf')).status,413);assert.equal(calls,2);
    mode='conversion_failure';const failed=await call(pdf,'print.pdf');assert.equal(failed.status,502);assert.equal((await failed.json()).code,'DOCUMENT_CONVERSION_FAILED');
    const failure=await db.prepare("SELECT usage FROM ai_requests WHERE status='DOCUMENT_CONVERSION_FAILED'").first();assert.equal(JSON.parse(failure.usage).failureStage,'document_conversion');
    mode='ok';const beforeText=calls;
    const textCall=text=>mf.dispatchFetch('https://test.local/api/ai/draft',{method:'POST',headers:{origin:'https://test.local',cookie,'content-type':'application/json'},body:JSON.stringify({documentText:text,sourceName:'printed-handout.pdf'})});
    const fromText=await textCall('数学の課題 問1を解く。締切9月18日。');assert.equal(fromText.status,200);const textResult=await fromText.json();assert.equal(textResult.usage.inputMode,'pdf_text');assert.equal(textResult.usage.conversionTokens,null);assert.equal(calls,beforeText+1,'Readable PDF text must need only the generation request');
    assert.equal((await textCall('x'.repeat(20001))).status,422);assert.equal(calls,beforeText+1);
    assert.equal((await textCall('x'.repeat(140000))).status,413,'oversized JSON is rejected before parsing');
    mode='slow';const aborted=await mf.dispatchFetch('https://test.local/__test/abort-ai',{method:'POST',headers:{origin:'https://test.local',cookie,'x-file-name':'print.png'},body:png});
    assert.equal(aborted.status,408,'disconnect cancels the running upstream request');
    assert.equal((await aborted.json()).code,'AI_CANCELLED');mode='ok';assert.equal((await call()).status,200,'the input slot is released after cancellation');
    mode='quota';assert.equal((await call()).status,502);const before=calls;assert.equal((await call()).status,429);assert.equal(calls,before);
    assert.equal((await call(Buffer.from('invalid'))).status,429,'a stop is checked before reading/validating input');
    await db.prepare('DELETE FROM ai_stops').run();await db.prepare('DELETE FROM ai_requests').run();mode='ok';
    const user=await db.prepare("SELECT id FROM user WHERE username='ai_test'").first();const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
    for(let i=0;i<20;i++)await db.prepare("INSERT INTO ai_requests(id,user_id,class_id,day,status,created_at) VALUES(?,?,?,?,'test',?)").bind(String(i),user.id,'prototype',day,new Date().toISOString()).run();
    assert.equal((await call()).status,429);assert.equal(calls,before);
    assert.equal((await call(Buffer.from('invalid'))).status,429,'daily allowance is checked before input');
    await db.prepare('DELETE FROM ai_requests').run();for(let i=0;i<50;i++)await db.prepare("INSERT INTO ai_requests(id,user_id,class_id,day,status,created_at) VALUES(?,?,?,?,'test',?)").bind(String(i),'other-'+i,'prototype',day,new Date().toISOString()).run();
    assert.equal((await call()).status,429);assert.equal(calls,before);
  }finally{await mf.dispose();}
});
