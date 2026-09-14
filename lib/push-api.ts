import { z } from "zod";
import { bindings } from "./auth";
import { apiError, HttpError, requireSession } from "./app-server";
import { buildPushRequest, runtime, json, subscriptionSchema, validEndpoint } from "./push-server";

type Sub={id:string;endpoint:string;p256dh:string;auth:string};
type Message={title:string;body:string;url:string;testId:string};
export async function sendToDevice(sub:Sub,message:Message) {
  const e=runtime(),db=e.DB;
  if(!validEndpoint(sub.endpoint))return "failed";
  const details=buildPushRequest({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify(message),{publicKey:e.VAPID_PUBLIC_KEY,privateKey:e.VAPID_PRIVATE_KEY,subject:e.VAPID_SUBJECT});
  let status="unknown";
  try {
    const response=await fetch(details.endpoint,{method:"POST",headers:details.headers as Record<string,string>,body:new Uint8Array(details.body as Buffer),redirect:"manual",signal:AbortSignal.timeout(10000)});
    status=response.ok?"accepted":"failed";
    if(response.status===404||response.status===410){await db.prepare("UPDATE subscriptions SET enabled=0,user_id=NULL,session_id=NULL WHERE id=?").bind(sub.id).run();status="expired";}
  } catch { status="unknown"; }
  const labels:Record<string,string>={accepted:"Pushサービス受付済み",failed:"送信失敗",unknown:"受付結果不明",expired:"通知登録の期限切れ"};
  await db.prepare("UPDATE subscriptions SET last_result=? WHERE id=?").bind(new Date().toISOString()+" · "+labels[status],sub.id).run();
  return status;
}
export async function sendUserNotification(userId:string,message:Message) {
  const db=bindings().DB;
  const rows=await db.prepare("SELECT p.id,p.endpoint,p.p256dh,p.auth FROM subscriptions p JOIN session s ON s.id=p.session_id WHERE p.user_id=? AND p.enabled=1 AND s.expiresAt>?").bind(userId,new Date().toISOString()).all<Sub>();
  if(!rows.results.length)return "not_registered";
  const statuses=await Promise.all(rows.results.map(async sub=>{
    const active=await db.prepare("SELECT id FROM subscriptions WHERE id=? AND user_id=? AND enabled=1").bind(sub.id,userId).first();
    return active?sendToDevice(sub,message):"not_registered";
  }));
  return statuses.every(s=>s==="accepted")?"accepted":statuses.includes("accepted")?"partial":statuses[0];
}
export async function handlePush(request:Request) {
  try {
    const s=await requireSession(request),db=bindings().DB;
    if(request.method==="GET"){
      const rows=await db.prepare("SELECT id,label,last_result,enabled,session_id=? AS currentDevice FROM subscriptions WHERE user_id=? ORDER BY updated_at DESC").bind(s.session.id,s.user.id).all();
      return json({publicKey:runtime().VAPID_PUBLIC_KEY,devices:rows.results});
    }
    if(new URL(request.url).pathname.endsWith("/send")) {
      const {id}=z.object({id:z.string().uuid()}).strict().parse(await request.json());
      const sub=await db.prepare("SELECT id,endpoint,p256dh,auth FROM subscriptions WHERE id=? AND user_id=? AND enabled=1").bind(id,s.user.id).first<Sub>();
      if(!sub)throw new HttpError(404,"自分の端末を登録してからお試しください。");
      const testId=crypto.randomUUID().slice(0,8),time=new Date().toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
      const status=await sendToDevice(sub,{title:"TaskBoost · 通知テスト",body:time+" JST · "+testId,url:"/?view=settings",testId});
      return json({status,testId},status==="accepted"?200:502);
    }
    if(request.method==="POST") {
      const {label,subscription}=z.object({label:z.string().trim().min(1).max(40),subscription:subscriptionSchema}).strict().parse(await request.json());
      const existing=await db.prepare("SELECT user_id FROM subscriptions WHERE endpoint=?").bind(subscription.endpoint).first<{user_id:string|null}>();
      if(existing?.user_id&&existing.user_id!==s.user.id)throw new HttpError(409,"この端末は別のユーザーに登録されています。前のユーザーでログアウトしてから登録してください。");
      const result=await db.prepare(`INSERT INTO subscriptions(id,label,endpoint,p256dh,auth,updated_at,user_id,session_id,enabled) VALUES(?,?,?,?,?,?,?,?,1)
        ON CONFLICT(endpoint) DO UPDATE SET label=excluded.label,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at,user_id=excluded.user_id,session_id=excluded.session_id,enabled=1
        WHERE subscriptions.user_id IS NULL OR subscriptions.user_id=excluded.user_id`).bind(crypto.randomUUID(),label,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,new Date().toISOString(),s.user.id,s.session.id).run();
      if(!result.meta.changes)throw new HttpError(409,"端末の登録状態が変わりました。再読み込みしてください。");
      return json({registered:true},201);
    }
    if(request.method==="DELETE") {
      const {endpoint}=z.object({endpoint:z.string().max(4096)}).strict().parse(await request.json());
      await db.prepare("UPDATE subscriptions SET user_id=NULL,session_id=NULL,enabled=0 WHERE endpoint=? AND user_id=?").bind(endpoint,s.user.id).run();
      return json({removed:true});
    }
    throw new HttpError(405,"この操作は利用できません。");
  } catch(error) {return apiError(error);}
}
