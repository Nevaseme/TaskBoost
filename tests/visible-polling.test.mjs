import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {build} from 'esbuild';

test('polling pauses when hidden, coalesces wake events and backs off after failures',async t=>{
  await mkdir('.sites-runtime/tests',{recursive:true});
  await build({entryPoints:['lib/visible-polling.ts'],outfile:'.sites-runtime/tests/visible-polling.mjs',bundle:true,format:'esm',platform:'node',logLevel:'silent'});
  const {startVisiblePolling,SNAPSHOT_INTERVAL,FILES_INTERVAL}=await import('../.sites-runtime/tests/visible-polling.mjs');
  const doc=new EventTarget();doc.visibilityState='visible';const win=new EventTarget();
  globalThis.document=doc;globalThis.window=win;
  t.after(()=>{delete globalThis.document;delete globalThis.window;});
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  let calls=0,ok=true,finish;
  const stop=startVisiblePolling(async()=>{calls++;if(finish)await new Promise(resolve=>{finish=resolve;});return ok;},SNAPSHOT_INTERVAL);
  await flush();assert.equal(calls,1);assert.ok(SNAPSHOT_INTERVAL>=30000);assert.ok(FILES_INTERVAL>=60000);
  win.dispatchEvent(new Event('pageshow'));win.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,1);
  t.mock.timers.tick(SNAPSHOT_INTERVAL);await flush();assert.equal(calls,2);
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(300000);await flush();assert.equal(calls,2);
  doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,3);
  ok=false;t.mock.timers.tick(SNAPSHOT_INTERVAL);await flush();assert.equal(calls,4);
  t.mock.timers.tick(SNAPSHOT_INTERVAL);await flush();assert.equal(calls,4);
  t.mock.timers.tick(SNAPSHOT_INTERVAL);await flush();assert.equal(calls,5);
  ok=true;finish=true;t.mock.timers.tick(SNAPSHOT_INTERVAL*4);await flush();assert.equal(calls,6);
  win.dispatchEvent(new Event('focus'));t.mock.timers.tick(300000);await flush();assert.equal(calls,6,'slow requests never overlap');
  stop();finish();await flush();t.mock.timers.tick(300000);win.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,6,'unmount stops work');
});
