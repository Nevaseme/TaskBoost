import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

test('Cron relay authenticates, correlates D1 response and closes manual entry (mock transport)', async () => {
  await mkdir('.sites-runtime/tests', { recursive: true });
  await build({ entryPoints: ['cron-worker/index.ts'], outfile: '.sites-runtime/tests/cron.mjs', bundle: true, format: 'esm', platform: 'node', external: ['node:*'], logLevel: 'silent' });
  const secret = 'test-cron-secret-at-least-32-characters';
  let calls = 0, mismatch = false;
  const options = { modules: true, scriptPath: '.sites-runtime/tests/cron.mjs', compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    bindings: { CRON_SECRET: secret, MANUAL_PROBE_ENABLED: 'true', SITE_TICK_URL: 'https://site.example/api/internal/reminders/tick' },
    outboundService: async request => {
      calls++;
      assert.equal(request.url, 'https://site.example/api/internal/reminders/tick');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('authorization'), 'Bearer '+secret);
      const id = request.headers.get('x-run-id');
      assert.match(id, /^[a-f0-9-]{36}$/);
      return Response.json({ runId: mismatch ? 'wrong-id' : id, dbConnected: true, at: new Date().toISOString(), sent: 0 });
    },
  };
  const mf = new Miniflare(options);
  try {
    const call = token => mf.dispatchFetch('https://worker.example/probe', { method: 'POST', headers: { authorization: 'Bearer '+token } });
    assert.equal((await call('wrong')).status, 401); assert.equal(calls, 0);
    const response = await call(secret); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.ok, true); assert.equal(result.trigger, 'manual'); assert.equal(result.sent, 0);
    mismatch = true;
    assert.equal((await call(secret)).status, 502);
    await mf.setOptions({ ...options, bindings: { ...options.bindings, MANUAL_PROBE_ENABLED: 'false' } });
    assert.equal((await call(secret)).status, 404); assert.equal(calls, 2);
  } finally { await mf.dispose(); }
});
