import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';

test('a stale list response or failure cannot replace the result of a newer refresh',async()=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  await build({entryPoints:['lib/latest-request.ts'],outfile:'.sites-runtime/tests/latest-request.mjs',bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {latestRequest}=await import('../.sites-runtime/tests/latest-request.mjs');
  const pending=[],shown=[];
  const refresh=latestRequest(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),value=>shown.push(value));
  const old=refresh(),newer=refresh();pending[1].resolve(['new-file']);assert.equal(await newer,true);
  pending[0].resolve([]);assert.equal(await old,false);assert.deepEqual(shown,[['new-file']]);
  const staleFailure=refresh(),latest=refresh();pending[3].resolve([]);await latest;
  pending[2].reject(new Error('stale failure'));await staleFailure;assert.deepEqual(shown,[['new-file'],[]]);
  const failed=refresh();pending[4].reject(new Error('current failure'));await assert.rejects(failed,/current failure/);
});
