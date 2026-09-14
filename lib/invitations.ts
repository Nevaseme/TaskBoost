import {randomBytes} from 'node:crypto';
import {bindings} from './auth';
import {apiError,HttpError,requireSession} from './app-server';
import {invitationHash} from './enrollment';
import {z} from 'zod';

export async function handleInvitation(request:Request){
  try{
    const session=await requireSession(request),db=bindings().DB;
    const admin=await db.prepare("SELECT id FROM user WHERE id=? AND classId=? AND role='admin'").bind(session.user.id,session.user.classId).first();
    if(!admin)throw new HttpError(403,'管理者だけが招待できます。');
    if(request.method==='GET'){
      const invitation=await db.prepare('SELECT created_at AS createdAt FROM class_invitations WHERE class_id=?').bind(session.user.classId).first();
      return Response.json({invitation},{headers:{'Cache-Control':'private, no-store'}});
    }
    if(request.method!=='POST')throw new HttpError(405,'この操作は利用できません。');
    const input=z.object({className:z.string().trim().min(1).max(60).optional()}).strict().parse(await request.text().then(t=>t?JSON.parse(t):{}));
    const existing=await db.prepare('SELECT name FROM classes WHERE id=?').bind(session.user.classId).first<{name:string}>();
    const className=input.className??existing?.name??'クラス';
    const code=randomBytes(12).toString('base64url'),createdAt=new Date().toISOString();
    await db.batch([db.prepare('INSERT INTO classes(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').bind(session.user.classId,className),db.prepare(`INSERT INTO class_invitations(class_id,code_hash,created_at,created_by) VALUES(?,?,?,?)
      ON CONFLICT(class_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=excluded.created_at,created_by=excluded.created_by`)
      .bind(session.user.classId,invitationHash(code),createdAt,session.user.id)]);
    return Response.json({code,createdAt,className},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return apiError(error);}
}
