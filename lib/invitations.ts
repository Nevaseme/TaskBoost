import {randomBytes} from 'node:crypto';
import {bindings} from './auth';
import {apiError,HttpError,requireSession} from './app-server';
import {invitationHash} from './enrollment';

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
    const code=randomBytes(12).toString('base64url'),createdAt=new Date().toISOString();
    await db.prepare(`INSERT INTO class_invitations(class_id,code_hash,created_at,created_by) VALUES(?,?,?,?)
      ON CONFLICT(class_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=excluded.created_at,created_by=excluded.created_by`)
      .bind(session.user.classId,invitationHash(code),createdAt,session.user.id).run();
    return Response.json({code,createdAt},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return apiError(error);}
}
