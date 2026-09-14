import { z } from "zod";
import { bindings } from "./auth";
import { apiError, HttpError, requireSession } from "./app-server";
import { sendUserNotification } from "./push-api";

// SQLite builds both conditions from the latest settings and deadline. Keeping
// eligibility inside the INSERT makes overlapping Cron invocations safe.
const eligible = `WITH plans AS (
  SELECT r.assignment_id,r.user_id,r.custom_at AS scheduled_at,'reminder_custom' AS reason,r.updated_at
  FROM reminder_settings r WHERE r.custom_at IS NOT NULL
  UNION ALL
  SELECT r.assignment_id,r.user_id,strftime('%Y-%m-%dT%H:%M:00.000Z',a.deadline,'-1 hour'),'reminder_deadline',r.updated_at
  FROM reminder_settings r JOIN assignments a ON a.id=r.assignment_id WHERE r.deadline_enabled=1
), eligible AS (
  SELECT p.* FROM plans p JOIN assignments a ON a.id=p.assignment_id JOIN user u ON u.id=p.user_id AND u.classId=a.class_id
  LEFT JOIN submissions s ON s.assignment_id=p.assignment_id AND s.user_id=p.user_id
  WHERE p.scheduled_at>=?1 AND p.scheduled_at<=?2 AND p.scheduled_at>=p.updated_at
    AND COALESCE(s.submitted,0)=0 AND (s.updated_at IS NULL OR s.updated_at<=p.scheduled_at)
)`;

export async function handleReminders(request:Request){
  try {
    const session=await requireSession(request),db=bindings().DB;
    const id=new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
    const task=await db.prepare("SELECT id FROM assignments WHERE id=? AND class_id=?").bind(id??"",session.user.classId).first();
    if(!task)throw new HttpError(404,"課題が見つかりません。");
    if(request.method==="GET"){
      const row=await db.prepare("SELECT custom_at AS customAt,deadline_enabled AS deadlineEnabled FROM reminder_settings WHERE assignment_id=? AND user_id=?").bind(id,session.user.id).first<{customAt:string|null;deadlineEnabled:number}>();
      return Response.json({customAt:row?.customAt??null,deadlineEnabled:!!row?.deadlineEnabled},{headers:{"Cache-Control":"no-store"}});
    }
    if(request.method!=="PUT")throw new HttpError(405,"この操作は利用できません。");
    const body=z.object({customAt:z.string().datetime().nullable(),deadlineEnabled:z.boolean()}).strict().parse(await request.json());
    const now=new Date().toISOString(),custom=body.customAt?new Date(body.customAt).toISOString().slice(0,16)+":00.000Z":null;
    const previous=await db.prepare("SELECT custom_at FROM reminder_settings WHERE assignment_id=? AND user_id=?").bind(id,session.user.id).first<{custom_at:string|null}>();
    if(custom&&custom<=now&&custom!==previous?.custom_at)throw new HttpError(400,"通知日時は現在より後の時刻を選んでください。");
    await db.prepare(`INSERT INTO reminder_settings(assignment_id,user_id,custom_at,deadline_enabled,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(assignment_id,user_id) DO UPDATE SET custom_at=excluded.custom_at,deadline_enabled=excluded.deadline_enabled,updated_at=excluded.updated_at`)
      .bind(id,session.user.id,custom,+body.deadlineEnabled,now).run();
    return Response.json({saved:true});
  }catch(error){return apiError(error);}
}

export async function runReminders(db:D1Database,runId:string,now=new Date()){
  const end=now.toISOString(),start=new Date(now.getTime()-5*60000).toISOString();
  await db.batch([
    db.prepare(`${eligible} INSERT INTO reminder_events(id,operation_id,assignment_id,user_id,scheduled_at,reasons,created_at)
      SELECT 'reminder:'||assignment_id||':'||user_id||':'||scheduled_at,?3,assignment_id,user_id,scheduled_at,group_concat(reason),?2
      FROM eligible GROUP BY assignment_id,user_id,scheduled_at ON CONFLICT DO NOTHING`).bind(start,end,runId),
    db.prepare(`INSERT INTO notifications(id,operation_id,assignment_id,recipient_id,actor_id,reasons,created_at)
      SELECT id,id,assignment_id,user_id,user_id,reasons,created_at FROM reminder_events WHERE operation_id=?
      ON CONFLICT DO NOTHING`).bind(runId),
  ]);
  const events=await db.prepare("SELECT id,assignment_id,user_id,scheduled_at FROM reminder_events WHERE operation_id=?").bind(runId).all<{id:string;assignment_id:string;user_id:string;scheduled_at:string}>();
  let sent=0,skipped=0;
  for(const event of events.results){
    // Claim only after the in-app notification is committed, and recheck the
    // current submission/settings immediately before handing off to Web Push.
    const fresh=new Date(Math.max(now.getTime(),Date.now())).toISOString();
    const row=await db.prepare(`${eligible} UPDATE notifications SET push_status='sending'
      WHERE id=?3 AND push_status='pending' AND EXISTS(SELECT 1 FROM eligible e WHERE e.assignment_id=?4 AND e.user_id=?5 AND e.scheduled_at=?6)
      RETURNING id`).bind(new Date(Date.parse(fresh)-5*60000).toISOString(),fresh,event.id,event.assignment_id,event.user_id,event.scheduled_at).first();
    if(!row){await db.prepare("UPDATE notifications SET push_status='cancelled' WHERE id=? AND push_status='pending'").bind(event.id).run();skipped++;continue;}
    const task=await db.prepare("SELECT title FROM assignments WHERE id=?").bind(event.assignment_id).first<{title:string}>();
    let status="unknown";
    try{status=await sendUserNotification(event.user_id,{title:"TaskBoost · リマインダー",body:`「${task?.title??"課題"}」は未提出です。`,url:`/?assignment=${event.assignment_id}`,testId:event.id});}catch{/* Uncertain sends are never retried. */}
    await db.prepare("UPDATE notifications SET push_status=? WHERE id=?").bind(status,event.id).run();
    console.log(JSON.stringify({event:"reminder_push",runId,notificationId:event.id,scheduledAt:event.scheduled_at,sentAt:new Date().toISOString(),pushStatus:status}));
    if(status==="accepted"||status==="partial")sent++;
  }
  return {created:events.results.length,sent,skipped};
}
