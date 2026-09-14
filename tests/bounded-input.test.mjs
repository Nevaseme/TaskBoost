import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('large inputs are serialized; overflow, abort and stalled bodies release the reader',async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  const path='.sites-runtime/tests/bounded-input.mjs';
  await build({entryPoints:['tests/input-worker.ts'],outfile:path,bundle:true,format:'esm',platform:'node',external:['node:*','cloudflare:workers'],banner:{js:'import {createRequire} from "node:module";const require=createRequire("/worker.js");'},logLevel:'silent'});
  const mf=new Miniflare({modules:[{type:'ESModule',path,contents:await readFile(path,'utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat']});
  try{
    for(const [route,status] of [['/overflow',413],['/header',413],['/abort',408],['/stall',408]]){
      const response=await mf.dispatchFetch('https://test.local'+route);assert.equal(response.status,status);assert.equal((await response.json()).cancelled,true);
    }
    assert.equal((await mf.dispatchFetch('https://test.local/slot')).status,429);
    assert.deepEqual(await (await mf.dispatchFetch('https://test.local/complete')).json(),{bytes:[1,2,3]});
  }finally{await mf.dispose();}
});
