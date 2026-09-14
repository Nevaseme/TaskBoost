import {HttpError} from './app-server';

/** Only idempotent DB deletion after confirmed R2 removal may be retried. */
export async function finishDeletion(statement:D1PreparedStatement){
  try{await statement.run();}
  catch{
    try{await statement.run();}
    catch{throw new HttpError(503,'削除の後処理を完了できませんでした。時間をおいて、もう一度削除してください。');}
  }
}
