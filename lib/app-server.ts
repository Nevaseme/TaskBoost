import { z } from "zod";
import { bindings, currentUser } from "./auth";
import { json } from "./push-server";
import { sendUserNotification } from "./push-api";
import { deleteAssignment } from "./assignment-deletion";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function apiError(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "入力内容を確認してください。" }, 400);
  console.error("TOMODACHI request failed", error instanceof Error ? error.name : "unknown");
  return json({ error: "保存・読み込みに失敗しました。時間をおいて再度お試しください。" }, 500);
}
export async function requireSession(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD" && request.headers.get("origin") !== new URL(request.url).origin) throw new HttpError(403, "この画面からもう一度操作してください。");
  const s = await currentUser(request);
  if (!s) throw new HttpError(401, "ログインしてください。");
  return s;
}
const assignmentBody = z.object({ subject: z.string().trim().min(1).max(40), title: z.string().trim().min(1).max(120), description: z.string().trim().max(2000), submissionFormat: z.string().trim().max(100).default(""), deadline: z.string().datetime() }).strict();

export async function handleApp(request: Request) {
  try {
    const s = await requireSession(request), db = bindings().DB;
    const userId = s.user.id, classId = s.user.classId;
    const parts = new URL(request.url).pathname.replace(/^\/api\/app\/?/, "").split("/").filter(Boolean);
    if (request.method === "GET" && !parts.length) {
      const result = await db.batch([
        db.prepare('SELECT id,name,username FROM user WHERE classId=? ORDER BY createdAt').bind(classId),
        db.prepare(`SELECT a.id,a.subject,a.title,a.description,a.submission_format AS submissionFormat,a.deadline,a.created_by AS createdBy,u.name AS creatorName,
          COALESCE(st.importance,2) AS importance,st.planned_for AS plannedFor,COALESCE(me.submitted,0) AS submitted,
          (SELECT count(*) FROM submissions x JOIN user m ON m.id=x.user_id WHERE x.assignment_id=a.id AND x.submitted=1 AND m.classId=a.class_id) AS submittedCount
          FROM assignments a JOIN user u ON u.id=a.created_by LEFT JOIN assignment_settings st ON st.assignment_id=a.id AND st.user_id=?
          LEFT JOIN submissions me ON me.assignment_id=a.id AND me.user_id=? WHERE a.class_id=? ORDER BY a.deadline,a.created_at`).bind(userId,userId,classId),
        db.prepare(`SELECT s.assignment_id AS assignmentId,s.user_id AS userId,s.updated_at AS updatedAt FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.class_id=? AND s.submitted=1`).bind(classId),
        db.prepare('SELECT first,half,two_thirds AS twoThirds,all_others AS allOthers FROM preferences WHERE user_id=?').bind(userId),
        db.prepare('SELECT friend_id FROM watches WHERE user_id=?').bind(userId),
        db.prepare(`SELECT n.id,n.assignment_id AS assignmentId,a.title,u.name AS actorName,n.reasons,n.created_at AS createdAt,n.read,n.push_status AS pushStatus FROM notifications n JOIN assignments a ON a.id=n.assignment_id JOIN user u ON u.id=n.actor_id WHERE n.recipient_id=? ORDER BY n.created_at DESC LIMIT 100`).bind(userId),
        db.prepare('SELECT name FROM classes WHERE id=?').bind(classId),
      ]);
      const p = (result[3].results[0] ?? {}) as Record<string,unknown>;
      return json({ className:(result[6].results[0] as {name:string}|undefined)?.name??"クラス", user: { id:userId,name:s.user.name,username:s.user.username,role:s.user.role }, members:result[0].results,assignments:result[1].results,submissions:result[2].results,
        preferences: { first:!!p.first,half:!!p.half,twoThirds:!!p.twoThirds,allOthers:!!p.allOthers,friends:(result[4].results as {friend_id:string}[]).map(r=>r.friend_id) }, notifications:result[5].results });
    }
    if(parts.length===1&&parts[0]==="class"&&request.method==="PUT"){
      if(s.user.role!=="admin")throw new HttpError(403,"管理者だけが変更できます。");
      const {name}=z.object({name:z.string().trim().min(1).max(60)}).strict().parse(await request.json());
      await db.prepare('INSERT INTO classes(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(classId,name).run();
      return json({saved:true});
    }
    if(parts.length===1&&parts[0]==="profile"&&request.method==="PUT"){
      const {name}=z.object({name:z.string().trim().min(1).max(40)}).strict().parse(await request.json());
      await db.prepare('UPDATE user SET name=?,updatedAt=? WHERE id=?').bind(name,Date.now(),userId).run();
      return json({saved:true});
    }
    if (parts[0] === "preferences" && request.method === "PUT") {
      const p = z.object({first:z.boolean(),half:z.boolean(),twoThirds:z.boolean(),allOthers:z.boolean(),friends:z.array(z.string()).max(50)}).strict().parse(await request.json());
      const friends = [...new Set(p.friends)].filter(id => id!==userId);
      const members = await db.prepare("SELECT id FROM user WHERE classId=?").bind(classId).all<{id:string}>();
      if (friends.some(id => !members.results.some(m=>m.id===id))) throw new HttpError(400,"同じクラスのメンバーを選んでください。");
      await db.batch([
        db.prepare("INSERT INTO preferences(user_id,first,half,two_thirds,all_others) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET first=excluded.first,half=excluded.half,two_thirds=excluded.two_thirds,all_others=excluded.all_others").bind(userId,+p.first,+p.half,+p.twoThirds,+p.allOthers),
        db.prepare("DELETE FROM watches WHERE user_id=?").bind(userId),
        ...friends.map(id=>db.prepare("INSERT INTO watches(user_id,friend_id) VALUES(?,?)").bind(userId,id)),
      ]);
      return json({saved:true});
    }
    if (parts[0] === "notifications" && request.method === "PUT") {
      await db.prepare("UPDATE notifications SET read=1 WHERE recipient_id=?").bind(userId).run();
      return json({saved:true});
    }
    if (parts[0] !== "assignments") throw new HttpError(404,"ページが見つかりません。");
    if (!parts[1] && request.method === "POST") {
      const a=assignmentBody.parse(await request.json()),id=crypto.randomUUID();
      await db.prepare("INSERT INTO assignments(id,class_id,subject,title,description,deadline,created_by,created_at,submission_format) VALUES(?,?,?,?,?,?,?,?,?)").bind(id,classId,a.subject,a.title,a.description,new Date(a.deadline).toISOString(),userId,new Date().toISOString(),a.submissionFormat).run();
      return json({id},201);
    }
    const id=parts[1];
    const assignment=await db.prepare("SELECT id,created_by FROM assignments WHERE id=? AND class_id=?").bind(id,classId).first<{id:string;created_by:string}>();
    if(!assignment)throw new HttpError(404,"課題が見つかりません。");
    if (!parts[2] && request.method === "PATCH") {
      if(assignment.created_by!==userId&&s.user.role!=="admin")throw new HttpError(403,"課題を変更できるのは登録者と管理者です。");
      const a=assignmentBody.parse(await request.json());
      await db.prepare("UPDATE assignments SET subject=?,title=?,description=?,deadline=?,submission_format=? WHERE id=? AND class_id=?").bind(a.subject,a.title,a.description,new Date(a.deadline).toISOString(),a.submissionFormat,id,classId).run();
      return json({saved:true});
    }
    if(!parts[2]&&request.method==="DELETE"){
      if(assignment.created_by!==userId&&s.user.role!=="admin")throw new HttpError(403,"課題を削除できるのは登録者と管理者です。");
      await deleteAssignment(db,id,classId,userId);
      return json({deleted:true});
    }
    if(parts[2]==="settings" && request.method==="PUT") {
      const a=z.object({importance:z.number().int().min(1).max(3),plannedFor:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>!isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d).nullable()}).strict().parse(await request.json());
      await db.prepare("INSERT INTO assignment_settings(assignment_id,user_id,importance,planned_for) VALUES(?,?,?,?) ON CONFLICT(assignment_id,user_id) DO UPDATE SET importance=excluded.importance,planned_for=excluded.planned_for").bind(id,userId,a.importance,a.plannedFor).run();
      return json({saved:true});
    }
    if(parts[2]==="submission" && request.method==="PUT") {
      const {submitted}=z.object({submitted:z.boolean()}).strict().parse(await request.json());
      const op=crypto.randomUUID(),now=new Date().toISOString();
      const writes=[db.prepare(`INSERT INTO submissions(assignment_id,user_id,submitted,updated_at,operation_id) VALUES(?,?,?,?,?)
        ON CONFLICT(assignment_id,user_id) DO UPDATE SET submitted=excluded.submitted,updated_at=excluded.updated_at,operation_id=excluded.operation_id WHERE submissions.submitted<>excluded.submitted`).bind(id,userId,+submitted,now,op)];
      if(submitted) {
        const conditions:Record<string,string>={
          friend:"EXISTS(SELECT 1 FROM watches w WHERE w.user_id=r.id AND w.friend_id=?3)",
          first:"p.first=1 AND stats.done=1",
          half:"p.half=1 AND stats.done=(stats.total+1)/2",
          two_thirds:"p.two_thirds=1 AND stats.done=(stats.total*2+2)/3",
          all_others:"p.all_others=1 AND stats.done=stats.total-1 AND NOT EXISTS(SELECT 1 FROM submissions x WHERE x.assignment_id=?1 AND x.user_id=r.id AND x.submitted=1)",
        };
        for(const [kind,condition] of Object.entries(conditions)) writes.push(db.prepare(`
          WITH stats AS (SELECT (SELECT count(*) FROM user WHERE classId=?2) AS total,
          (SELECT count(*) FROM submissions x JOIN user m ON m.id=x.user_id WHERE x.assignment_id=?1 AND x.submitted=1 AND m.classId=?2) AS done)
          INSERT INTO notification_events(dedupe_key,operation_id,assignment_id,recipient_id,kind)
          SELECT ?1||':'||r.id||':${kind}'${kind==="friend"?"||':'||?3":""},?4,?1,r.id,'${kind}'
          FROM user r CROSS JOIN stats LEFT JOIN preferences p ON p.user_id=r.id
          WHERE r.classId=?2 AND r.id<>?3 AND (${condition})
          AND EXISTS(SELECT 1 FROM submissions x WHERE x.assignment_id=?1 AND x.user_id=?3 AND x.operation_id=?4 AND x.submitted=1)
          ON CONFLICT(dedupe_key) DO NOTHING`).bind(id,classId,userId,op));
        writes.push(db.prepare(`INSERT INTO notifications(id,operation_id,assignment_id,recipient_id,actor_id,reasons,created_at)
          SELECT ?1||':'||recipient_id,?1,?2,recipient_id,?3,group_concat(kind),?4 FROM notification_events WHERE operation_id=?1 GROUP BY recipient_id
          ON CONFLICT(operation_id,recipient_id) DO NOTHING`).bind(op,id,userId,now));
      }
      await db.batch(writes);
      const pending=await db.prepare("UPDATE notifications SET push_status='sending' WHERE operation_id=? AND push_status='pending' RETURNING id,recipient_id,assignment_id").bind(op).all<{id:string;recipient_id:string;assignment_id:string}>();
      for(const n of pending.results) {
        let status="failed";
        try { status=await sendUserNotification(n.recipient_id,{title:"TaskBoost",body:`${s.user.name}さんが課題を提出しました。`,url:`/?assignment=${n.assignment_id}`,testId:n.id}); } catch { status="unknown"; }
        await db.prepare("UPDATE notifications SET push_status=? WHERE id=?").bind(status,n.id).run();
      }
      return json({saved:true});
    }
    throw new HttpError(405,"この操作は利用できません。");
  } catch(error) { return apiError(error); }
}
