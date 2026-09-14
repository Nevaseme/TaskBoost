import {env} from 'cloudflare:workers';
import {HttpError} from './app-server';
import {checkStorageAccess,guardedStorage} from './storage-budget';
import {finishDeletion} from './deletion-cleanup';

export async function deleteAssignment(db:D1Database,id:string,classId:string,userId:string){
  const files=await db.prepare('SELECT id,storage_key FROM assignment_files WHERE assignment_id=?').bind(id).all<{id:string;storage_key:string}>();
  if(files.results.length){
    const {BUCKET,STORAGE_DB,STORAGE_EPOCH}=env as unknown as {BUCKET?:R2Bucket;STORAGE_DB?:D1Database;STORAGE_EPOCH?:string};
    if(!BUCKET||!STORAGE_DB)throw new HttpError(503,'添付を削除できません。時間をおいてお試しください。');
    const storage=guardedStorage(STORAGE_DB,BUCKET,STORAGE_EPOCH);
    for(const file of files.results){
      await checkStorageAccess(STORAGE_DB,STORAGE_EPOCH,userId,'delete');
      await storage.delete(file.storage_key);
      await finishDeletion(db.prepare('DELETE FROM assignment_files WHERE id=? AND assignment_id=?').bind(file.id,id));
    }
  }
  // A concurrent attachment INSERT keeps the parent alive via its foreign key.
  // D1 rolls the whole batch back so submissions/settings are not lost.
  try{
    await db.batch([
      ...['notifications','notification_events','reminder_events','reminder_settings','assignment_settings','submissions'].map(table=>db.prepare(`DELETE FROM ${table} WHERE assignment_id=?`).bind(id)),
      db.prepare('DELETE FROM assignments WHERE id=? AND class_id=?').bind(id,classId),
    ]);
  }catch{throw new HttpError(409,'課題を削除できませんでした。再読み込みして、もう一度お試しください。');}
}
