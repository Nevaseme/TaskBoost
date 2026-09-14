import {createHash,timingSafeEqual} from 'node:crypto';

export const invitationHash=(code:string)=>createHash('sha256').update(code).digest('hex');
export async function acceptsInvitation(db:D1Database,classId:string,code:unknown,legacy:string){
  if(typeof code!=='string'||!code||code.length>128)return false;
  const current=await db.prepare('SELECT code_hash FROM class_invitations WHERE class_id=?').bind(classId).first<{code_hash:string}>();
  const expected=current?.code_hash??(legacy?invitationHash(legacy):'');
  if(!/^[a-f0-9]{64}$/.test(expected))return false;
  return timingSafeEqual(Buffer.from(invitationHash(code),'hex'),Buffer.from(expected,'hex'));
}
