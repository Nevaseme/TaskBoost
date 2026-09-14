export type Attachment={id:string;name:string;contentType:string;size:number;sha256:string};
type SavedAttachment={id:string;sha256:string;size:number};
const uncertainSave='保存を確認できませんでした。再読み込みして添付一覧を確認してください。';
const uncertainDelete='削除を確認できませんでした。再読み込みして添付一覧を確認してください。';
export class AttachmentSaveUnconfirmed extends Error {
  constructor(){super(uncertainSave);this.name='AttachmentSaveUnconfirmed';}
}
class RejectedTransfer extends Error {}

async function request<T>(url:string,init:RequestInit,read:(response:Response)=>Promise<T>,failure:string,signal?:AbortSignal){
  const controller=new AbortController();let timedOut=false;
  const cancel=()=>controller.abort(signal?.reason);
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},45000);
  try{
    const response=await fetch(url,{...init,cache:'no-store',credentials:'same-origin',signal:controller.signal});
    if(!response.ok){
      const data=await response.json().catch(()=>null) as {error?:unknown}|null;
      if(response.status<500&&response.status!==408)throw new RejectedTransfer(typeof data?.error==='string'?data.error:failure);
      throw new Error(failure);
    }
    return await read(response);
  }catch(error){
    if(signal?.aborted)throw error;
    if(timedOut||error instanceof TypeError||error instanceof SyntaxError)throw new Error(failure);
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export async function uploadAttachment(assignmentId:string,file:File):Promise<SavedAttachment>{
  if(file.size>20*1024*1024)throw new Error('ファイルは20MiB以下にしてください。');
  try{return await request(`/api/files/${assignmentId}`,{method:'POST',headers:{'x-file-name':encodeURIComponent(file.name),'content-type':'application/octet-stream'},body:file},async response=>{
    const data=await response.json() as Partial<SavedAttachment>|null;
    if(!data||typeof data.id!=='string'||!data.id||typeof data.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(data.sha256)||data.size!==file.size)throw new Error(uncertainSave);
    return data as SavedAttachment;
  },uncertainSave);}catch(error){if(error instanceof RejectedTransfer)throw error;throw new AttachmentSaveUnconfirmed();}
}
export async function fetchAttachment(assignmentId:string,attachment:Attachment,signal?:AbortSignal){
  const failure='資料を取得できませんでした。通信状態を確認して、もう一度お試しください。';
  return request(`/api/files/${assignmentId}/${attachment.id}?download=1`,{},async response=>{
    if(response.headers.get('content-type')?.split(';')[0].trim()!==attachment.contentType)throw new Error(failure);
    const blob=await response.blob();if(blob.size!==attachment.size)throw new Error(failure);
    return new File([blob],attachment.name,{type:attachment.contentType});
  },failure,signal);
}
export async function deleteAttachment(assignmentId:string,id:string){
  return request(`/api/files/${assignmentId}/${id}`,{method:'DELETE'},async response=>{
    const data=await response.json() as {deleted?:unknown}|null;
    if(data?.deleted!==true)throw new Error(uncertainDelete);
  },uncertainDelete);
}
