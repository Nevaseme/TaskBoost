import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';

test('attachment transfers distinguish confirmation, failure, timeout and cancellation',async t=>{
 await mkdir('.sites-runtime/tests',{recursive:true});
 const source=await readFile('lib/attachment-client.ts','utf8');
 await writeFile('.sites-runtime/tests/attachment-client.mjs',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 const {uploadAttachment,fetchAttachment,deleteAttachment,AttachmentSaveUnconfirmed}=await import('../.sites-runtime/tests/attachment-client.mjs');
 const original=globalThis.fetch,originalTimeout=globalThis.setTimeout;
 const file=new File(['%PDF- test'],'test.pdf',{type:'application/pdf'}),saved={id:'test-id',sha256:'a'.repeat(64),size:file.size},attachment={...saved,name:file.name,contentType:file.type};
 try{
  await t.test('HTML or malformed success responses never confirm an upload',async()=>{
   globalThis.fetch=async()=>new Response('<html>Connection interrupted</html>',{status:200,headers:{'content-type':'text/html'}});
   await assert.rejects(uploadAttachment('assignment',file),/保存を確認できません/);
   for(const result of [null,{}, {...saved,size:file.size+1},{...saved,sha256:'invalid'}]){
    globalThis.fetch=async()=>Response.json(result);await assert.rejects(uploadAttachment('assignment',file),/保存を確認できません/);
   }
  });
  await t.test('valid uploads preserve the confirmation and API limit messages',async()=>{
   globalThis.fetch=async(_url,init)=>{assert.ok(init.signal instanceof AbortSignal);assert.equal(init.credentials,'same-origin');return Response.json(saved);};
   assert.deepEqual(await uploadAttachment('assignment',file),saved);
   globalThis.fetch=async()=>Response.json({error:'本日の添付の利用上限に達しました。'},{status:429});
   await assert.rejects(uploadAttachment('assignment',file),error=>!(error instanceof AttachmentSaveUnconfirmed)&&/本日の添付の利用上限/.test(error.message));
  });
  await t.test('a lost acknowledgement is distinguishable from a rejected upload',async()=>{
   let savedOnServer=0;globalThis.fetch=async()=>{savedOnServer++;throw new TypeError('connection lost after commit');};
   await assert.rejects(uploadAttachment('assignment',file),AttachmentSaveUnconfirmed);assert.equal(savedOnServer,1);
   globalThis.fetch=async()=>Response.json({error:'database response unavailable'},{status:500});
   await assert.rejects(uploadAttachment('assignment',file),AttachmentSaveUnconfirmed);
  });
  await t.test('downloads reject an HTML page and truncated bytes',async()=>{
   globalThis.fetch=async()=>new Response('<html>Login</html>',{headers:{'content-type':'text/html'}});
   await assert.rejects(fetchAttachment('assignment',attachment),/資料を取得できません/);
   globalThis.fetch=async()=>new Response('short',{headers:{'content-type':file.type}});
   await assert.rejects(fetchAttachment('assignment',attachment),/資料を取得できません/);
   globalThis.fetch=async()=>new Response(file,{headers:{'content-type':file.type}});
   const downloaded=await fetchAttachment('assignment',attachment);assert.equal(await downloaded.text(),await file.text());assert.equal(downloaded.name,file.name);
  });
  await t.test('deletion needs an explicit confirmation',async()=>{
   for(const data of [null,{},{deleted:false}]){globalThis.fetch=async()=>Response.json(data);await assert.rejects(deleteAttachment('assignment','file'),/削除を確認できません/);}
   globalThis.fetch=async()=>Response.json({deleted:true});await deleteAttachment('assignment','file');
  });
  await t.test('a stalled request expires without an automatic retry',async()=>{
   let requests=0;
   globalThis.setTimeout=(callback,ms,...args)=>{assert.equal(ms,45000);return originalTimeout(callback,5,...args);};
   globalThis.fetch=async(_url,init)=>{requests++;return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));};
   try{await assert.rejects(uploadAttachment('assignment',file),/保存を確認できません/);assert.equal(requests,1);}
   finally{globalThis.setTimeout=originalTimeout;}
  });
  await t.test('the deadline also covers a response body that never finishes',async()=>{
   globalThis.setTimeout=(callback,ms,...args)=>{assert.equal(ms,45000);return originalTimeout(callback,5,...args);};
   globalThis.fetch=async(_url,init)=>new Response(new ReadableStream({start(controller){init.signal.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});}}),{headers:{'content-type':'application/json'}});
   try{await assert.rejects(uploadAttachment('assignment',file),/保存を確認できません/);}
   finally{globalThis.setTimeout=originalTimeout;}
  });
  await t.test('closing a preview can cancel its body transfer',async()=>{
   const controller=new AbortController();let requests=0;
   globalThis.fetch=async(_url,init)=>{requests++;return new Response(new ReadableStream({start(body){init.signal.addEventListener('abort',()=>body.error(init.signal.reason),{once:true});}}),{headers:{'content-type':file.type}});};
   const downloading=fetchAttachment('assignment',attachment,controller.signal);controller.abort();
   await assert.rejects(downloading,{name:'AbortError'});assert.equal(requests,1);
  });
 }finally{globalThis.fetch=original;globalThis.setTimeout=originalTimeout;}
});
