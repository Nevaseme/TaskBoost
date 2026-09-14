import { env } from "cloudflare:workers";
import { hasInternalSecret } from "./internal-auth";
import { runReminders } from "./reminders";

const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
type TickEnv = { DB: D1Database; CRON_SECRET?: string };

export async function handleReminderTick(request: Request) {
  const e = env as unknown as TickEnv;
  if (!hasInternalSecret(request, e.CRON_SECRET)) return reply({ error: "Unauthorized" }, 401);
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const suppliedId = request.headers.get("x-run-id");
  if (!suppliedId || !/^[a-f0-9-]{36}$/i.test(suppliedId)) return reply({ error: "Invalid run ID" }, 400);
  try {
    const row = await e.DB.prepare("SELECT 1 AS connected").first<{ connected: number }>();
    if (row?.connected !== 1) throw new Error("D1 unavailable");
    const delivery = await runReminders(e.DB,suppliedId);
    const result = { runId: suppliedId, phase: "reminders", dbConnected: true, ...delivery, at: new Date().toISOString() };
    console.log(JSON.stringify({ event: "reminder_tick", ...result }));
    return reply(result);
  } catch {
    return reply({ runId: suppliedId, error: "D1_UNAVAILABLE" }, 503);
  }
}
