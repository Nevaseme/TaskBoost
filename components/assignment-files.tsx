"use client";
import { useMemo, useEffect, useRef, useState } from "react";
import { PdfPreview } from "./pdf-preview";
import { startVisiblePolling, FILES_INTERVAL } from "@/lib/visible-polling";
import { latestRequest } from "@/lib/latest-request";

type Attachment = { id:string; name:string; contentType:string; size:number; sha256:string };
function downloadFile(file:File){const url=URL.createObjectURL(file),a=document.createElement("a");a.href=url;a.download=file.name;a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
async function fetchAttachment(assignmentId:string,attachment:Attachment){
  const r=await fetch(`/api/files/${assignmentId}/${attachment.id}?download=1`,{cache:"no-store"});
  if(!r.ok){const data=await r.json().catch(()=>null) as {error?:unknown}|null;throw new Error(typeof data?.error==="string"?data.error:"資料を取得できませんでした。");}
  return new File([await r.blob()],attachment.name,{type:attachment.contentType});
}
export async function uploadAttachment(assignmentId:string,file:File) {
  if(file.size>20*1024*1024) throw new Error("ファイルは20MiB以下にしてください。");
  const r=await fetch(`/api/files/${assignmentId}`,{method:"POST",credentials:"same-origin",headers:{"x-file-name":encodeURIComponent(file.name),"content-type":"application/octet-stream"},body:file});
  const data=await r.json().catch(()=>({error:"添付を保存できませんでした。"})) as {id:string;sha256:string;size:number;error?:string};
  if(!r.ok)throw new Error(data.error??"添付を保存できませんでした。");
  return data as {id:string;sha256:string;size:number};
}
export function AssignmentFiles({assignmentId,canEdit}:{assignmentId:string;canEdit:boolean}) {
  const [files,setFiles]=useState<Attachment[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[loaded,setLoaded]=useState(false);
  const [preview,setPreview]=useState<Attachment|null>(null);
  const refresh=useMemo(()=>latestRequest(async()=>{
    const r=await fetch(`/api/files/${assignmentId}`,{cache:"no-store",signal:AbortSignal.timeout(15000)});
    const data=await r.json() as {files:Attachment[];error?:string}; if(!r.ok)throw new Error(data.error??"添付を読み込めませんでした。");
    return data.files;
  },value=>{setFiles(value);setLoaded(true);}),[assignmentId]);
  useEffect(()=>{let active=true;const stop=startVisiblePolling(async()=>{
    try{const applied=await refresh();if(active&&applied)setError("");return applied;}
    catch(e){if(active)setError((e as Error).message);return false;}
  },FILES_INTERVAL);return()=>{active=false;stop();};},[refresh]);
  async function add(file?:File){if(!file)return;setBusy(true);setError("");try{await uploadAttachment(assignmentId,file);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function remove(id:string){setBusy(true);setError("");try{const r=await fetch(`/api/files/${assignmentId}/${id}`,{method:"DELETE"});if(!r.ok)throw new Error((await r.json() as {error:string}).error);await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function download(attachment:Attachment){setBusy(true);setError("");try{downloadFile(await fetchAttachment(assignmentId,attachment));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="personal-settings" aria-label="添付資料" onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}>
    <h3>添付資料</h3><p className="support">PDF・Word・画像 ／ 1件20MiB・5件まで</p>
    {error&&<p className="banner error" role="alert">{error}</p>}
    {!loaded&&!error?<p>読み込んでいます…</p>:!files.length?<p>添付資料はありません。</p>:<ul className="attachment-list">{files.map(f=><li key={f.id}><p className="attachment-name">{f.name} <small>（{(f.size/1024/1024).toFixed(2)} MiB）</small></p><div className="attachment-actions">{!f.contentType.includes("wordprocessingml")&&<button className="btn outline" type="button" onClick={()=>setPreview(f)}>開く</button>}<button className="btn outline" type="button" disabled={busy} onClick={()=>void download(f)}>ダウンロード</button>{canEdit&&<button className="btn text" type="button" disabled={busy} onClick={()=>void remove(f.id)}>削除</button>}</div></li>)}</ul>}
    {canEdit&&<label>資料を添付<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" disabled={busy||files.length>=5} onChange={e=>{void add(e.target.files?.[0]);e.target.value="";}}/></label>}
    {busy&&<p role="status">処理しています…</p>}
    {preview&&<AttachmentPreview assignmentId={assignmentId} attachment={preview} onClose={()=>setPreview(null)}/>}
  </section>;
}

function AttachmentPreview({assignmentId,attachment,onClose}:{assignmentId:string;attachment:Attachment;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[file,setFile]=useState<File|null>(null),[url,setUrl]=useState(""),[error,setError]=useState("");
  useEffect(()=>{
    let active=true,objectUrl="";const node=dialog.current;node?.showModal();
    void (async()=>{try{
      const f=await fetchAttachment(assignmentId,attachment);if(!active)return;
      objectUrl=URL.createObjectURL(f);setFile(f);setUrl(objectUrl);
    }catch(e){if(active)setError((e as Error).message);}})();
    return()=>{active=false;node?.close();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[assignmentId,attachment]);
  const canShare=!!file&&typeof navigator!=="undefined"&&!!navigator.canShare?.({files:[file]});
  async function share(){if(!file)return;setError("");try{
    await navigator.share({files:[file],title:attachment.name});
  }catch(e){if((e as Error).name!=="AbortError")setError("保存・共有を開始できませんでした。ブラウザで開いて保存してください。");}}
  return <dialog ref={dialog} className="attachment-preview" onCancel={onClose} aria-label="添付資料のプレビュー">
    <div className="preview-toolbar"><button type="button" className="btn outline" onClick={onClose}>閉じる ×</button><div className="attachment-actions"><button type="button" className="btn outline" disabled={!file} onClick={()=>file&&downloadFile(file)}>ダウンロード</button>{canShare&&<button type="button" className="btn" onClick={()=>void share()}>共有</button>}</div></div>
    <p className="attachment-name">{attachment.name}</p>{error&&<p role="alert" className="banner error">{error}</p>}
    {!file&&!error&&<p role="status">資料を読み込んでいます…</p>}
    {url&&(attachment.contentType==="application/pdf"?<PdfPreview url={url}/>:attachment.contentType.startsWith("image/")?
      // User-owned blob URLs must stay local to this authenticated browser.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={attachment.name} className="attachment-image"/>:<p>上のボタンからWordファイルを保存・共有できます。</p>)}
  </dialog>;
}
