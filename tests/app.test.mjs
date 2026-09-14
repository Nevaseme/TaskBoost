import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import webpush from "web-push";
import { createECDH, randomBytes } from "node:crypto";

test("registered users share assignments; invitation, ownership and deduplication are enforced", async () => {
  await mkdir(".sites-runtime/tests", { recursive: true });
  await build({ entryPoints: ["tests/app-worker.ts"], outfile: ".sites-runtime/tests/app.mjs", bundle: true, format: "esm", platform: "node", target: "es2022", external: ["node:*", "cloudflare:workers"], banner: { js: 'import {createRequire} from "node:module";const require=createRequire("/worker.js");' }, logLevel: "silent" });
  const vapid = webpush.generateVAPIDKeys();
  let outbound = 0;
  const mf = new Miniflare({ modules: [{ type: "ESModule", path: ".sites-runtime/tests/app.mjs", contents: await readFile(".sites-runtime/tests/app.mjs", "utf8") }], compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB"], bindings: { BETTER_AUTH_URL: "https://test.local", BETTER_AUTH_SECRET: "test-only-secret-with-more-than-32-characters", CLASS_INVITE_CODE: "test-invite", VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "https://example.com" }, outboundService: async () => { outbound++; return new Response(null, { status: 201 }); } });
  try {
    const db = await mf.getD1Database("DB");
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) {
      for (const sql of (await readFile("drizzle/" + file, "utf8")).split("--> statement-breakpoint").filter(s => s.trim())) await db.prepare(sql).run();
    }
    const call = (path, body, cookie = "", method = body ? "POST" : "GET") => mf.dispatchFetch("https://test.local" + path, { method, headers: { origin: "https://test.local", "content-type": "application/json", cookie, "cf-connecting-ip": "192.0.2.10" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const signup = async (username, inviteCode = "test-invite") => {
      const response = await call("/api/auth/sign-up/email", { name: username, username, password: "prototype-test-password", email: "attacker@example.com", inviteCode });
      await db.prepare('DELETE FROM rateLimit').run();
      return response;
    };
    assert.equal((await call("/api/app")).status, 401);
    assert.equal((await signup("blocked", "wrong")).status, 403);
    const a = await signup("student_a"); assert.equal(a.status, 200, await a.clone().text());
    const ac = a.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    const b = await signup("student_b"); assert.equal(b.status, 200, await b.clone().text());
    const bc = b.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    const au = await (await call("/api/app", undefined, ac)).json();
    const bu = await (await call("/api/app", undefined, bc)).json();
    assert.equal(au.members.length, 2);
    const emails = await db.prepare('SELECT email FROM user').all();
    assert.ok(emails.results.every(u => u.email.endsWith("@tomodachi.invalid")));
    const created = await call("/api/app/assignments", { subject: "数学", title: "問題集 p.20", description: "問1〜5", deadline: "2026-10-01T09:00:00.000Z" }, ac);
    assert.equal(created.status, 201, await created.clone().text());
    const { id } = await created.json();
    assert.equal((await call(`/api/app/assignments/${id}`, { title: "changed" }, bc, "PATCH")).status, 403);
    await call(`/api/app/assignments/${id}/settings`, { importance: 3, plannedFor: "2026-09-14" }, ac, "PUT");
    await call("/api/app/preferences", { friends: [au.user.id], first: true, half: true, twoThirds: true, allOthers: true }, bc, "PUT");
    const receiver = createECDH("prime256v1"); receiver.generateKeys();
    const subscription = { endpoint: "https://web.push.apple.com/app-test", keys: { p256dh: receiver.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
    assert.equal((await call("/api/push", { label: "Bの端末", subscription }, bc)).status, 201);
    const submit = () => call(`/api/app/assignments/${id}/submission`, { submitted: true }, ac, "PUT");
    const responses = await Promise.all([submit(), submit()]);
    for (const r of responses) assert.equal(r.status, 200, await r.clone().text());
    let bs = await (await call("/api/app", undefined, bc)).json();
    assert.equal(bs.notifications.length, 1);
    assert.equal(bs.notifications[0].pushStatus, "accepted"); assert.equal(outbound, 1);
    assert.deepEqual(bs.notifications[0].reasons.split(",").sort(), ["all_others", "first", "friend", "half"]);
    assert.equal(bs.assignments[0].importance, 2);
    assert.equal(bs.assignments[0].plannedFor, null);
    assert.equal(bs.assignments[0].submittedCount, 1);
    await call(`/api/app/assignments/${id}/submission`, { submitted: false }, ac, "PUT");
    await submit();
    bs = await (await call("/api/app", undefined, bc)).json();
    assert.equal(bs.notifications.length, 1);
    assert.equal((await call(`/api/app/assignments/${id}/submission`, { submitted: true, userId: bu.user.id }, ac, "PUT")).status, 400);
    assert.equal((await call("/api/push", undefined, "")).status, 401);
    assert.equal((await call("/api/push", { label: "別人", subscription }, ac)).status, 409);
    assert.equal((await call("/api/auth/sign-out", {}, bc)).status, 200);
    assert.equal((await call("/api/app", undefined, bc)).status, 401);
    const detached = await db.prepare('SELECT user_id,enabled FROM subscriptions').first();
    assert.equal(detached.user_id, null); assert.equal(detached.enabled, 0);
    assert.equal((await call("/api/push", { label: "Aの端末", subscription }, ac)).status, 201);

    const cookies = [ac];
    for (let i = 2; i < 6; i++) {
      const r = await signup("student_" + i); assert.equal(r.status, 200, await r.clone().text());
      cookies.push(r.headers.getSetCookie().map(v => v.split(";")[0]).join("; "));
      if (i !== 2 && i !== 5) continue;
      const recipient = cookies.at(-1), total = i + 1;
      await call("/api/app/preferences", { friends: [], first: true, half: true, twoThirds: true, allOthers: true }, recipient, "PUT");
      const created = await call("/api/app/assignments", { subject: "境界テスト", title: total + "人", description: "", deadline: "2026-10-01T09:00:00.000Z" }, ac);
      const assignment = (await created.json()).id;
      const submitters = [...cookies.slice(0, -1), (await call("/api/auth/sign-in/username", { username: "student_b", password: "prototype-test-password" })).headers.getSetCookie().map(v => v.split(";")[0]).join("; ")];
      for (const cookie of submitters) assert.equal((await call(`/api/app/assignments/${assignment}/submission`, { submitted: true }, cookie, "PUT")).status, 200);
      const notes = (await (await call("/api/app", undefined, recipient)).json()).notifications.filter(n => n.assignmentId === assignment);
      assert.equal(notes.length, total === 3 ? 2 : 4);
      if (total === 3) assert.ok(notes.some(n => n.reasons.split(",").sort().join(",") === "all_others,half,two_thirds"));
      else assert.deepEqual(notes.map(n => n.reasons).sort(), ["all_others", "first", "half", "two_thirds"]);
    }
    let limited;
    for (let i = 0; i < 11; i++) limited = await call("/api/auth/sign-in/username", { username: "missing_user", password: "wrong-password" });
    assert.equal(limited.status, 429);
  } finally { await mf.dispose(); }
});
