"use client";
import { useEffect,useState } from "react";

export function ReminderSettings({assignmentId}:{assignmentId:string}){
  const [custom,setCustom]=useState(""),[enabled,setEnabled]=useState(false),[deadline,setDeadline]=useState(false),[busy,setBusy]=useState(true),[message,setMessage]=useState(""),[error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    void fetch(`/api/reminders/${assignmentId}`,{cache:"no-store"}).then(async r=>{
      const data=await r.json() as {customAt:string|null;deadlineEnabled:boolean;error?:string};if(!r.ok)throw new Error(data.error??"通知設定を読み込めませんでした。");if(!active)return;
      setDeadline(data.deadlineEnabled);setEnabled(!!data.customAt);setCustom(data.customAt?new Date(Date.parse(data.customAt)+9*3600000).toISOString().slice(0,16):"");
    }).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
  },[assignmentId]);
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch(`/api/reminders/${assignmentId}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({customAt:enabled?new Date(custom+":00+09:00").toISOString():null,deadlineEnabled:deadline})});
      if(!r.ok)throw new Error((await r.json() as {error?:string}).error??"通知設定を保存できませんでした。");setMessage("自分への通知を保存しました。");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <details className="personal-settings" onTouchStart={e=>e.stopPropagation()} onTouchEnd={e=>e.stopPropagation()}><summary>自分への通知</summary><form onSubmit={save}>
    <p className="support">未提出時のみ通知（日本時間）。受信には「設定」で端末を登録してください。</p>
    <label className="check-line"><input type="checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/>指定した日時に通知</label>
    {enabled&&<label>通知日時<input type="datetime-local" value={custom} required disabled={busy} onChange={e=>setCustom(e.target.value)}/></label>}
    <label className="check-line"><input type="checkbox" checked={deadline} disabled={busy} onChange={e=>setDeadline(e.target.checked)}/>締切1時間前に通知</label>
    <button className="btn outline" disabled={busy}>通知設定を保存</button>{error&&<p role="alert" className="banner error">{error}</p>}{message&&<p role="status" className="banner success">{message}</p>}
  </form></details>;
}
