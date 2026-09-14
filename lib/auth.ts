import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { acceptsInvitation } from "./enrollment";

export function bindings() {
  return env as unknown as { DB: D1Database; BETTER_AUTH_URL: string; BETTER_AUTH_SECRET: string; CLASS_INVITE_CODE: string };
}
export function auth() {
  const e = bindings();
  if (!e.DB) throw new Error("Persistent database binding DB is required.");
  return betterAuth({
    database: e.DB, baseURL: e.BETTER_AUTH_URL, secret: e.BETTER_AUTH_SECRET, trustedOrigins: [e.BETTER_AUTH_URL],
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
    plugins: [username()],
    user: { additionalFields: { classId: { type: "string", required: true, defaultValue: "prototype", input: false }, role: {type:"string",required:true,defaultValue:"member",input:false} } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] }, defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: e.BETTER_AUTH_URL.startsWith("https:") } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100, customRules: { "/sign-up/email": { window: 60, max: 5 }, "/sign-in/username": { window: 60, max: 10 }, "/change-password": {window:60,max:5} } },
    hooks: { before: createAuthMiddleware(async ctx => {
      if (ctx.path === "/sign-up/email") {
        if (!await acceptsInvitation(e.DB,"prototype",ctx.body?.inviteCode,e.CLASS_INVITE_CODE)) throw new APIError("FORBIDDEN", { message: "招待コードを確認してください。" });
        const id = String(ctx.body?.username ?? "").toLowerCase();
        const name = String(ctx.body?.name ?? "").trim();
        if (!/^[a-z0-9_.]{3,30}$/.test(id) || !name || name.length > 40) throw new APIError("BAD_REQUEST", { message: "表示名とIDの入力を確認してください。" });
        return { context: { ...ctx, body: { ...ctx.body, name, username: id, email: `u_${crypto.randomUUID()}@tomodachi.invalid`, classId: "prototype",role:"member" } } };
      }
      if(ctx.path==="/change-password")return {context:{...ctx,body:{...ctx.body,revokeOtherSessions:true}}};
      if (["/update-user", "/change-email", "/delete-user", "/sign-in/email", "/request-password-reset"].includes(ctx.path)) throw new APIError("FORBIDDEN", { message: "この操作は利用できません。" });
    }) },
    databaseHooks: { session: { delete: { before: async s => { await e.DB.prepare("UPDATE subscriptions SET user_id=NULL, session_id=NULL, enabled=0 WHERE session_id=?").bind(s.id).run(); } } } },
  });
}
export async function currentUser(request: Request) {
  return auth().api.getSession({ headers: request.headers });
}
