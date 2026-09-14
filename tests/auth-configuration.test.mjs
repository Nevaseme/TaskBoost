import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('registration cannot succeed when persistent storage is missing',async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  await build({entryPoints:['tests/app-worker.ts'],outfile:'.sites-runtime/tests/auth-configuration.mjs',bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
  const mf=new Miniflare({modules:[{type:'ESModule',path:'.sites-runtime/tests/auth-configuration.mjs',contents:await readFile('.sites-runtime/tests/auth-configuration.mjs','utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],bindings:{BETTER_AUTH_URL:'https://test.local',BETTER_AUTH_SECRET:'local-test-secret-with-at-least-32-characters',CLASS_INVITE_CODE:'local-check'}});
  try{
    const response=await mf.dispatchFetch('https://test.local/api/auth/sign-up/email',{method:'POST',headers:{origin:'https://test.local','content-type':'application/json'},body:JSON.stringify({username:'test_user',name:'確認',email:'placeholder@example.invalid',password:'local-test-password',inviteCode:'local-check'})});
    assert.ok(response.status>=500,`Registration unexpectedly returned ${response.status}`);
    assert.equal(response.headers.get('set-cookie'),null);
  }finally{await mf.dispose();}
});
