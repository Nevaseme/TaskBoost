import { env } from "cloudflare:workers";
import webpush from "web-push";
import { z } from "zod";

type Runtime = { DB: D1Database; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string; VAPID_SUBJECT: string };
export function runtime() {
  const bindings = env as unknown as Runtime;
  if (!bindings.DB || !bindings.VAPID_PRIVATE_KEY || !bindings.VAPID_PUBLIC_KEY || !bindings.VAPID_SUBJECT) {
    throw new Error("通知送信の設定がまだ完了していません。");
  }
  return bindings;
}
export function validEndpoint(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname.endsWith(".push.apple.com") || u.hostname === "fcm.googleapis.com" ||
       u.hostname === "updates.push.services.mozilla.com" || u.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export const subscriptionSchema = z.object({
  endpoint: z.string().max(4096).refine(validEndpoint, "対応するPushサービスのURLではありません。"),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
});
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function routeError(error: unknown) {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "入力形式が正しくありません。" }, 400);
  // Do not log raw push endpoints, auth keys, or cryptographic errors.
  return json({ error: "処理に失敗しました。設定または接続を確認し、もう一度お試しください。" }, 500);
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new z.ZodError([]);
}
export function buildPushRequest(subscription: webpush.PushSubscription, payload: string, keys: { publicKey: string; privateKey: string; subject: string }) {
  // Use the library only for RFC encryption/signing; Workers sends with native fetch.
  return webpush.generateRequestDetails(subscription, payload, {
    vapidDetails: keys, TTL: 300, urgency: "high", contentEncoding: "aes128gcm",
  });
}
