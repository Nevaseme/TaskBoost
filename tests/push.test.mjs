import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, readdir } from "node:fs/promises";
import { createECDH, randomBytes, createPublicKey, verify } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import webpush from "web-push";
import ece from "http_ece";
import vm from "node:vm";

test("Sites Workers runtime: D1, VAPID, encrypted push and failure handling", async () => {
  await mkdir(".sites-runtime/tests",{recursive:true});
  await build({entryPoints:["tests/worker-entry.ts"],outfile:".sites-runtime/tests/worker.mjs",bundle:true,format:"esm",platform:"node",target:"es2022",external:["node:*","cloudflare:workers"],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:"silent"});
  const vapid=webpush.generateVAPIDKeys();
  const receiver=createECDH("prime256v1");receiver.generateKeys();
  const auth=randomBytes(16);
  const endpoint="https://web.push.apple.com/test-only-subscription";
  const subscription={endpoint,keys:{p256dh:receiver.getPublicKey().toString("base64url"),auth:auth.toString("base64url")}};
  let outbound=0,status=201,networkFailure=false;
  const mf=new Miniflare({
    modules:[{type:"ESModule",path:".sites-runtime/tests/worker.mjs",contents:await readFile(".sites-runtime/tests/worker.mjs","utf8")}],compatibilityDate:"2026-05-15",compatibilityFlags:["nodejs_compat"],
    d1Databases:["DB"],bindings:{VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:"https://example.com",BETTER_AUTH_URL:"https://test.local",BETTER_AUTH_SECRET:"push-test-secret-longer-than-thirty-two-characters",CLASS_INVITE_CODE:"push-test-invite"},
    outboundService:async request=>{
      try {
      outbound++;assert.equal(request.url,endpoint);assert.equal(request.method,"POST");
      assert.equal(request.headers.get("content-encoding"),"aes128gcm");assert.equal(request.headers.get("ttl"),"300");
      const authorization=request.headers.get("authorization");
      const jwt=authorization.match(/t=([^, ]+)/)[1];const [head,payload,sig]=jwt.split(".");
      const claims=JSON.parse(Buffer.from(payload,"base64url"));assert.equal(claims.aud,"https://web.push.apple.com");
      assert.ok(claims.exp>Date.now()/1000&&claims.exp<Date.now()/1000+86401);
      const pub=Buffer.from(vapid.publicKey,"base64url");
      const key=createPublicKey({key:{kty:"EC",crv:"P-256",x:pub.subarray(1,33).toString("base64url"),y:pub.subarray(33).toString("base64url")},format:"jwk"});
      assert.ok(verify("sha256",Buffer.from(head+"."+payload),{key,dsaEncoding:"ieee-p1363"},Buffer.from(sig,"base64url")));
      const plaintext=ece.decrypt(Buffer.from(await request.arrayBuffer()),{version:"aes128gcm",privateKey:receiver,authSecret:auth});
      const message=JSON.parse(plaintext.toString());assert.match(message.title,/TaskBoost/);assert.match(message.body,/JST/);assert.ok(message.testId);
      if(networkFailure)throw new Error("simulated network failure");
      return new Response(null,{status});
      } catch(error) { if(!networkFailure)console.error("Mock receiver verification:",error);throw error; }
    },
  });
  try {
    const db=await mf.getD1Database("DB");
    for(const file of (await readdir("drizzle")).filter(f=>f.endsWith(".sql")).sort())for(const statement of (await readFile("drizzle/"+file,"utf8")).split("--> statement-breakpoint").filter(s=>s.trim()))await db.prepare(statement).run();
    const signup=await mf.dispatchFetch("https://test.local/api/auth/sign-up/email",{method:"POST",headers:{"content-type":"application/json",origin:"https://test.local","cf-connecting-ip":"192.0.2.5"},body:JSON.stringify({name:"test",username:"testuser",password:"prototype-password",email:"pending@example.com",inviteCode:"push-test-invite"})});
    assert.equal(signup.status,200,await signup.clone().text());
    const cookie=signup.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
    const call=(path="",body,method)=>mf.dispatchFetch("https://test.local/api/push"+path,{method:method??(body?"POST":"GET"),headers:{"content-type":"application/json","origin":"https://test.local",cookie},body:body?JSON.stringify(body):undefined});
    assert.equal((await call("",{label:"test",subscription:{...subscription,endpoint:"https://example.com"}})).status,400);
    assert.equal((await call("",{label:"test",subscription})).status,201);
    assert.equal((await call("",{label:"renamed",subscription})).status,201);
    const listing=await (await call()).json();assert.equal(listing.devices.length,1);assert.equal(listing.devices[0].label,"renamed");
    assert.ok(!JSON.stringify(listing).includes(endpoint));assert.ok(!JSON.stringify(listing).includes(vapid.privateKey));
    const id=listing.devices[0].id;
    assert.equal((await call("/send",{id})).status,200);assert.equal(outbound,1);
    assert.match((await (await call()).json()).devices[0].last_result,/受付済み/);
    status=403;assert.equal((await call("/send",{id})).status,502);
    status=302;assert.equal((await call("/send",{id})).status,502);
    networkFailure=true;assert.equal((await call("/send",{id})).status,502);networkFailure=false;
    status=410;assert.equal((await call("/send",{id})).status,502);assert.equal((await (await call()).json()).devices.length,0);
    assert.equal((await call("/send",{id})).status,404);
    assert.equal((await call("",{label:"test",subscription})).status,201);
    assert.equal((await call("",{endpoint},"DELETE")).status,200);
    assert.equal((await (await call()).json()).devices.length,0);
    const cross=await mf.dispatchFetch("https://test.local/api/push",{method:"POST",headers:{origin:"https://other.local","content-type":"application/json"},body:JSON.stringify({label:"x",subscription})});
    assert.equal(cross.status,403);
  } finally {await mf.dispose();}
});

test("Service Worker displays each push without a server fetch and handles clicks",async()=>{
 const handlers={};const shown=[];let focused=0,opened=0;
 let navigated="";
 const self={addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},location:{origin:"https://test.local"},registration:{showNotification:async(title,options)=>shown.push({title,...options})},clients:{claim:async()=>{},matchAll:async()=>[{url:"https://test.local/",navigate:async url=>navigated=url,focus:()=>focused++}],openWindow:async()=>opened++}};
 vm.runInNewContext(await readFile("public/sw.js","utf8"),{self,URL});
 let task;const waitUntil=p=>task=p;
 handlers.push({data:{json:()=>({title:"test",body:"locked",testId:"abc"})},waitUntil});await task;
 assert.equal(shown[0].body,"locked");assert.equal(shown[0].tag,"abc");
 handlers.push({data:{json:()=>{throw Error();}},waitUntil});await task;assert.equal(shown.length,2);
 handlers.notificationclick({notification:{close(){},data:{url:"/?assignment=123"}},waitUntil});await task;assert.equal(focused,1);assert.equal(navigated,"/?assignment=123");
 handlers.notificationclick({notification:{close(){},data:{url:"https://malicious.example"}},waitUntil});await task;assert.equal(navigated,"/");
 self.clients.matchAll=async()=>[];handlers.notificationclick({notification:{close(){}},waitUntil});await task;assert.equal(opened,1);
});

