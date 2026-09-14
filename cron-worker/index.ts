import { hasInternalSecret } from "../lib/internal-auth";

type Env = { SITE_TICK_URL: string; CRON_SECRET: string; MANUAL_PROBE_ENABLED?: string };

async function tick(env: Env, trigger: "manual" | "cron") {
  const runId = crypto.randomUUID();
  try {
    const url = new URL(env.SITE_TICK_URL);
    if (url.protocol !== "https:" || url.pathname !== "/api/internal/reminders/tick") throw new Error("Invalid target");
    const response = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${env.CRON_SECRET}`, "x-run-id": runId } });
    const body = await response.json() as { runId?: string; dbConnected?: boolean; at?: string; sent?: number };
    const ok = response.ok && body.runId === runId && body.dbConnected === true;
    const result = { event: "sites_tick", runId, trigger, ok, status: response.status, sitesAt: body.at, at: new Date().toISOString(), sent: body.sent };
    console.log(JSON.stringify(result));
    if (!ok) throw new Error("Sites tick failed");
    return result;
  } catch {
    console.error(JSON.stringify({ event: "sites_tick_failed", runId, trigger, at: new Date().toISOString() }));
    throw new Error("Sites tick failed");
  }
}

export default {
  async fetch(request: Request, env: Env) {
    if (env.MANUAL_PROBE_ENABLED !== "true" || new URL(request.url).pathname !== "/probe") return new Response("Not found", { status: 404 });
    if (!hasInternalSecret(request, env.CRON_SECRET)) return new Response("Unauthorized", { status: 401 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try { return Response.json(await tick(env, "manual"), { headers: { "Cache-Control": "no-store" } }); }
    catch { return Response.json({ error: "Connection failed" }, { status: 502 }); }
  },
  async scheduled(_controller: ScheduledController, env: Env) { await tick(env, "cron"); },
} satisfies ExportedHandler<Env>;
