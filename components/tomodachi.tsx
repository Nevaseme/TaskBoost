"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, CalendarDays, Check, ChevronRight, Menu, Plus, Bell, Settings, Users, X } from "lucide-react";
import Link from "next/link";
import { AssignmentFiles, uploadAttachment } from "./assignment-files";
import { ReminderSettings } from "./reminder-settings";
import { AiInput, type AiDraft } from "./ai-input";
import { type Assignment, type Preferences, type Snapshot, emptyPreferences, reasonLabels, todayJst } from "@/lib/types";
import { startVisiblePolling, SNAPSHOT_INTERVAL } from "@/lib/visible-polling";
import { InvitationSettings } from "./invitation-settings";

async function api<T>(path:string,body?:unknown,method=body?"POST":"GET",signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{method,signal,credentials:"same-origin",cache:"no-store",...(body?{headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{})});
  if(!response.headers.get("content-type")?.includes("application/json"))throw new Error("画面を再読み込みして、もう一度お試しください。");
  const data=await response.json() as T & {error?:string;message?:string};
  if(!response.ok){const error=new Error(data.error??data.message??"処理に失敗しました。") as Error&{status:number};error.status=response.status;throw error;}
  return data;
}
const dateTimeFormatter=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",weekday:"short",hour:"2-digit",minute:"2-digit"});
const dateTime=(value:string)=>dateTimeFormatter.format(new Date(value));
type View="today"|"assignments"|"notifications"|"settings";
const pages={today:{label:"今日",icon:CalendarDays},assignments:{label:"課題",icon:BookOpen},notifications:{label:"通知",icon:Bell},settings:{label:"設定",icon:Settings}};

export default function Tomodachi(){
  const [data,setData]=useState<Snapshot|null>(null),[loading,setLoading]=useState(true),[view,setView]=useState<View>("today"),[selected,setSelected]=useState<string|null>(null);
  const [menu,setMenu]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[editor,setEditor]=useState<Assignment|"new"|null>(null);
  const loaded=useRef(false),generation=useRef(0),refreshing=useRef<Promise<boolean>|null>(null),authenticated=useRef<boolean|null>(null);
  const refresh=useCallback(function refresh(force=false):Promise<boolean>{
    if(refreshing.current)return force?refreshing.current.then(()=>refresh(true)):refreshing.current;
    const requestGeneration=generation.current;
    const request=(async()=>{
    try{
      const result=await api<Snapshot>("/api/app",undefined,"GET",AbortSignal.timeout(15000));
      if(requestGeneration!==generation.current)return true;
      authenticated.current=true;setData(previous=>JSON.stringify(previous)===JSON.stringify(result)?previous:result);setError("");
      if(!loaded.current){const query=new URLSearchParams(window.location.search);const a=query.get("assignment"),v=query.get("view");if(a){setSelected(a);setView("assignments");}else if(v&&v in pages)setView(v as View);loaded.current=true;}
      return true;
    }catch(e){
      if(requestGeneration!==generation.current)return true;
      if((e as Error&{status:number}).status===401){authenticated.current=false;setData(null);}else setError((e as Error).name==="TimeoutError"?"読み込みに時間がかかっています。通信状態を確認してください。":(e as Error).message);
      return false;
    }finally{refreshing.current=null;if(requestGeneration===generation.current)setLoading(false);}
    })();
    refreshing.current=request;return request;
  },[]);
  useEffect(()=>{
    const stop=startVisiblePolling(()=>authenticated.current===false?Promise.resolve(true):refresh(),SNAPSHOT_INTERVAL);
    if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).catch(()=>{});
    return stop;
  },[refresh]);
  function navigate(next:View,id:string|null=null){setView(next);setSelected(id);setMenu(false);setNotice("");window.history.replaceState(null,"",id?`/?assignment=${id}`:`/?view=${next}`);}
  async function mutate(path:string,body:unknown,method:string,message:string){
    if(busy)return;setBusy(true);setError("");setNotice("");
    try{await api(path,body,method);await refresh(true);setNotice(message);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function signOut(){
    setBusy(true);
    try{await api("/api/auth/sign-out",{});generation.current++;authenticated.current=false;setData(null);setSelected(null);setEditor(null);setNotice("");loaded.current=false;window.history.replaceState(null,"","/");}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const today=todayJst(),active=data?.assignments.filter(a=>!a.submitted)??[],planned=active.filter(a=>a.plannedFor===today);
  const selectedAssignment=data?.assignments.find(a=>a.id===selected);
  const unread=data?.notifications.filter(n=>!n.read).length??0;
  return <>
    <a className="skip-link" href="#main">本文へ移動</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" href="/" aria-label="TaskBoost ホーム"><BookOpen aria-hidden="true" size={27}/><span>TaskBoost</span></Link>

      {data&&<><nav className="desktop-nav" aria-label="メイン">{Object.entries(pages).map(([key,p])=><button key={key} onClick={()=>navigate(key as View)} aria-current={view===key?"page":undefined}>{p.label}{key==="notifications"&&unread>0&&<span className="count">{unread}<span className="sr-only">件未読</span></span>}</button>)}</nav>
      <button className="mobile-menu-button btn outline" aria-expanded={menu} aria-controls="mobile-nav" onClick={()=>setMenu(!menu)}>{menu?<X size={20}/>:<Menu size={20}/>}メニュー</button></>}
    </div>{data&&menu&&<nav id="mobile-nav" className="mobile-nav" aria-label="メイン">{Object.entries(pages).map(([key,p])=><button key={key} aria-current={view===key?"page":undefined} onClick={()=>navigate(key as View)}>{p.label}{key==="notifications"&&unread>0?`（未読${unread}件）`:""}<ChevronRight size={18}/></button>)}</nav>}</header>
    <main id="main" tabIndex={-1}>
      {loading?<p className="loading" role="status">読み込んでいます…</p>:!data?<AuthForm onSuccess={async()=>{await refresh(true);}}/>:<>
        <div className="page-heading"><div><p className="context"><Users size={18} aria-hidden="true"/>クラス · {data.members.length}人<span className="user-name">{data.user.name}さん</span></p><h1>{pages[view].label}</h1></div>{(view==="today"||view==="assignments")&&<button className="btn" onClick={()=>setEditor("new")}><Plus size={20} aria-hidden="true"/>課題を登録</button>}</div>
        {view==="today"&&<>
          <p className="date-line">{new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",dateStyle:"full"}).format(new Date())}</p>
          <section className="today-summary" aria-label="今日の課題"><h2>今日やること</h2><span className="big-count">{planned.length}<small>件</small></span></section>
          {planned.length?<div className="resource-list">{planned.map(a=><AssignmentRow key={a.id} a={a} total={data.members.length} onOpen={()=>navigate("assignments",a.id)}/>)}</div>:<div className="empty"><CalendarDays size={32} aria-hidden="true"/><h3>今日の予定はありません</h3><button className="btn outline" onClick={()=>navigate("assignments")}>課題を見る</button></div>}
          <div className="section-heading"><h2>締切が近い課題</h2><span>{active.length}件の未提出</span></div>
          {active.length?<div className="resource-list">{active.slice(0,5).map(a=><AssignmentRow key={a.id} a={a} total={data.members.length} onOpen={()=>navigate("assignments",a.id)}/>)}</div>:<p className="empty-line">{data.assignments.length?"すべて提出済みです。":"課題はありません。"}</p>}
        </>}
        {view==="assignments"&&<div className={`assignment-layout ${selectedAssignment?"has-selection":""}`}>
          <section className="assignment-list" aria-label="課題一覧"><p className="list-summary">全{data.assignments.length}件 · 未提出{active.length}件</p>
          {data.assignments.length?<div className="resource-list">{data.assignments.map(a=><AssignmentRow key={a.id} a={a} selected={selected===a.id} total={data.members.length} onOpen={()=>navigate("assignments",a.id)}/>)}</div>:<div className="empty"><BookOpen size={32} aria-hidden="true"/><h2>課題はありません</h2><button className="btn" onClick={()=>setEditor("new")}>課題を登録</button></div>}</section>
          {selectedAssignment?<AssignmentDetail key={selectedAssignment.id} a={selectedAssignment} data={data} busy={busy} onBack={()=>navigate("assignments")} onEdit={()=>setEditor(selectedAssignment)} onChange={(action,body,message)=>mutate(`/api/app/assignments/${selectedAssignment.id}/${action}`,body,"PUT",message)}/>:<section className="detail-placeholder"><BookOpen size={40} aria-hidden="true"/><p>{selected?"課題が見つかりません。":"課題を選択"}</p></section>}
        </div>}
        {view==="notifications"&&<section><div className="section-heading"><h2>通知</h2>{unread>0&&<button className="btn text" disabled={busy} onClick={()=>mutate("/api/app/notifications",{},"PUT","すべて既読にしました。")}>すべて既読にする</button>}</div>
          {data.notifications.length?<div className="resource-list">{data.notifications.map(n=><button className="notification-row" key={n.id} onClick={()=>navigate("assignments",n.assignmentId)}><Bell size={22} aria-hidden="true"/><span><span className="row-title">{n.title}{!n.read&&<span className="tag">未読</span>}</span><span className="notification-body">{n.reasons.includes("reminder_")?"自分へのリマインダー":`${n.actorName}さんが提出しました`}</span><span className="metadata">{n.reasons.split(",").map(r=>reasonLabels[r]).join("・")}</span><time className="metadata">{dateTime(n.createdAt)}</time></span><ChevronRight size={20} aria-hidden="true"/></button>)}</div>:<div className="empty"><Bell size={32} aria-hidden="true"/><h3>通知はまだありません</h3><button className="btn outline" onClick={()=>navigate("settings")}>通知を設定</button></div>}</section>}
        {view==="settings"&&<SettingsPanel data={data} busy={busy} onSave={p=>mutate("/api/app/preferences",p,"PUT","通知設定を保存しました。")} onSignOut={signOut}/>}
        {editor&&<AssignmentEditor assignment={editor==="new"?undefined:editor} onClose={()=>setEditor(null)} onSaved={async id=>{setEditor(null);await refresh(true);navigate("assignments",id);setNotice("課題を保存しました。");}}/>}
      </>}
      {error&&<div className="banner error" role="alert">{error}</div>}{notice&&<div className="banner success" role="status"><Check size={20} aria-hidden="true"/>{notice}</div>}
    </main>
  </>;
}

function AuthForm({onSuccess}:{onSuccess:()=>Promise<void>}){
  const [register,setRegister]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");
    try{await api(register?"/api/auth/sign-up/email":"/api/auth/sign-in/username",{username:String(f.get("username")).toLowerCase(),password:f.get("password"),...(register?{name:f.get("name"),email:"pending@tomodachi.invalid",inviteCode:f.get("inviteCode")}: {})});await onSuccess();}
    catch(e){const message=(e as Error).message;setError(/[a-z]{3}/i.test(message)?register?"登録できませんでした。IDの重複、招待コード、パスワードを確認してください。":"ログインできませんでした。IDとパスワードを確認してください。":message);}finally{setBusy(false);}
  }
  return <div className="auth-layout"><section className="auth-panel"><h1>{register?"新規登録":"ログイン"}</h1>
      <form onSubmit={submit} aria-describedby={error?"auth-error":undefined}>
        {register&&<label>表示名<span className="required">必須</span><input name="name" autoComplete="nickname" maxLength={40} required/></label>}
        <label>ID<span className="required">必須</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9_.]{3,30}" minLength={3} maxLength={30} required aria-describedby={register?"id-help":undefined}/></label>{register&&<p id="id-help" className="support">英数字・「_」「.」で3〜30文字（大小文字の区別なし）</p>}
        <label>パスワード<span className="required">必須</span><input name="password" type="password" autoComplete={register?"new-password":"current-password"} minLength={register?10:1} maxLength={128} required aria-describedby={register?"password-help":undefined}/></label>{register&&<p className="support" id="password-help">10文字以上</p>}
        {register&&<label>招待コード<span className="required">必須</span><input name="inviteCode" autoComplete="off" autoCapitalize="none" spellCheck={false} required/></label>}
        {error&&<p id="auth-error" className="banner error" role="alert">{error}</p>}
        <button className="btn full" disabled={busy}>{busy?"確認しています…":register?"登録":"ログイン"}</button>
      </form><button className="btn text full" onClick={()=>{setRegister(!register);setError("");}} disabled={busy}>{register?"ログインへ":"新規登録"}</button>
    </section></div>;
}

function AssignmentRow({a,total,selected,onOpen}:{a:Assignment;total:number;selected?:boolean;onOpen:()=>void}){
  const overdue=!a.submitted&&new Date(a.deadline)<new Date();
  return <button className={`assignment-row ${selected?"selected":""}`} onClick={onOpen} aria-current={selected?"true":undefined}><span className={`subject-icon ${a.submitted?"done":""}`}>{a.submitted?<Check size={22} aria-hidden="true"/>:<BookOpen size={22} aria-hidden="true"/>}</span><span className="row-content"><span className="metadata">{a.subject}<span className={`tag ${a.submitted?"success":""}`}>{a.submitted?"提出済み":"未提出"}</span></span><span className="row-title">{a.title}</span><span className={overdue?"deadline overdue":"deadline"}>{overdue?"期限切れ · ":"締切 "}{dateTime(a.deadline)}</span><span className="metadata">{a.submittedCount}/{total}人が提出{a.importance===3?" · 重要度 高":""}{a.plannedFor===todayJst()?" · 今日やる":""}</span></span><ChevronRight size={20} aria-hidden="true"/></button>;
}

function AssignmentDetail({a,data,busy,onBack,onEdit,onChange}:{a:Assignment;data:Snapshot;busy:boolean;onBack:()=>void;onEdit:()=>void;onChange:(action:string,body:unknown,message:string)=>Promise<void>}){
  const touch=useRef<{x:number;y:number}|null>(null);
  const planned=a.plannedFor===todayJst();
  const plan=()=>onChange("settings",{importance:a.importance,plannedFor:planned?null:todayJst()},planned?"今日やることから外しました。":"今日やることに追加しました。");
  return <section className="assignment-detail" aria-label="課題の詳細" onTouchStart={e=>{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}} onTouchEnd={e=>{if(!touch.current)return;const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y;if(Math.abs(dx)>90&&Math.abs(dx)>Math.abs(dy)*2&&touch.current.x>30)void plan();touch.current=null;}}>
    <button className="btn text back-to-list" onClick={onBack}>課題一覧に戻る</button><div className="detail-top"><span className="tag">{a.subject}</span>{a.createdBy===data.user.id&&<button className="btn text" onClick={onEdit}>編集する</button>}</div><h2>{a.title}</h2>
    <dl className="detail-meta"><div><dt>締切</dt><dd>{dateTime(a.deadline)}</dd></div><div><dt>登録者</dt><dd>{a.creatorName}</dd></div></dl>{a.description&&<p className="description">{a.description}</p>}
    {a.submissionFormat&&<p className="support">提出形式：{a.submissionFormat}</p>}
    <AssignmentFiles assignmentId={a.id} canEdit={a.createdBy===data.user.id}/>
    <ReminderSettings key={a.id} assignmentId={a.id}/>
    <div className="personal-settings"><h3>自分の取り組み</h3><label className="check-line"><input type="checkbox" checked={planned} disabled={busy} onChange={()=>void plan()}/>今日やる</label>
      <label className="inline-label">重要度<select value={a.importance} disabled={busy} onChange={e=>void onChange("settings",{importance:Number(e.target.value),plannedFor:a.plannedFor},"重要度を変更しました。")}><option value={1}>低</option><option value={2}>中</option><option value={3}>高</option></select></label>
      <button className={`btn full ${a.submitted?"outline":""}`} disabled={busy} onClick={()=>void onChange("submission",{submitted:!a.submitted},a.submitted?"未提出に戻しました。":"提出済みにしました。")}>{a.submitted?"提出済みを取り消す":<><Check size={20} aria-hidden="true"/>提出済みにする</>}</button>
    </div><div className="section-heading"><h3>みんなの提出状況</h3><span>{a.submittedCount}/{data.members.length}人</span></div><ul className="member-list">{data.members.map(m=>{const done=data.submissions.find(s=>s.assignmentId===a.id&&s.userId===m.id);return <li key={m.id}><span>{m.name}{m.id===data.user.id?"（自分）":""}</span><span className={`tag ${done?"success":""}`}>{done?"提出済み":"未提出"}</span></li>;})}</ul>
  </section>;
}

function AssignmentEditor({assignment,onClose,onSaved}:{assignment?:Assignment;onClose:()=>void;onSaved:(id:string)=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),form=useRef<HTMLFormElement>(null),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState("");
  const [sources,setSources]=useState<File[]>([]),[savedId,setSavedId]=useState<string|null>(null),[readNotice,setReadNotice]=useState("");
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  const localDeadline=assignment?new Date(new Date(assignment.deadline).getTime()+9*60*60*1000).toISOString().slice(0,16):"";
  function applyDraft(d:AiDraft,file:File){
    for(const [name,value] of Object.entries(d)){const input=form.current?.elements.namedItem(name) as HTMLInputElement|HTMLTextAreaElement|null;if(input)input.value=value;}
    setSources(files=>[...files,file]);setReadNotice("読み取り結果を確認してください。");
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError("");
    try{
      let id=savedId;
      if(!id){const f=new FormData(e.currentTarget);const result=await api<{id?:string}>(assignment?`/api/app/assignments/${assignment.id}`:"/api/app/assignments",{
        subject:f.get("subject"),title:f.get("title"),description:f.get("description"),submissionFormat:f.get("submissionFormat"),deadline:new Date(String(f.get("deadlineDate"))+"T"+String(f.get("deadlineTime"))+":00+09:00").toISOString(),
      },assignment?"PATCH":"POST");id=result.id??assignment!.id;setSavedId(id);}
      for(const file of sources){await uploadAttachment(id,file);setSources(remaining=>remaining.filter(f=>f!==file));}
      await onSaved(id);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <dialog ref={dialog} aria-labelledby="editor-title" onCancel={e=>{if(busy||reading)e.preventDefault();else onClose();}}><form ref={form} onSubmit={submit}><div className="dialog-heading"><h2 id="editor-title">{assignment?"課題を編集":"課題を登録"}</h2><button type="button" className="btn text" aria-label="閉じる" disabled={busy||reading} onClick={onClose}><X size={24}/></button></div><p className="support">共有先：クラス全員</p>
    {!assignment&&<AiInput disabled={busy||!!savedId||sources.length>=5} onDraft={applyDraft} onBusy={setReading}/>}{readNotice&&<p className="banner" role="status">{readNotice}</p>}
    <fieldset disabled={busy||reading||!!savedId} style={{border:0,padding:0,margin:0}}>
    <label>教科名<span className="required">必須</span><input name="subject" defaultValue={assignment?.subject} maxLength={40} required/></label><label>課題名<span className="required">必須</span><input name="title" defaultValue={assignment?.title} maxLength={120} required/></label>
    <label>締切の日付（日本時間）<span className="required">必須</span><input name="deadlineDate" type="date" defaultValue={localDeadline.slice(0,10)} required/></label><label>締切の時刻<span className="required">必須</span><input name="deadlineTime" type="time" defaultValue={localDeadline.slice(11)} required/></label>
    <label>説明<textarea name="description" defaultValue={assignment?.description} rows={4} maxLength={2000}/></label><label>提出形式<input name="submissionFormat" defaultValue={assignment?.submissionFormat} maxLength={100} placeholder="例：紙で提出、オンライン提出"/></label>
    <label>添付資料（任意・1件20MiB、5件まで）<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" disabled={sources.length>=5} onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>20*1024*1024)setError("ファイルは20MiB以下にしてください。");else setSources(files=>[...files,file]);}e.target.value="";}}/></label>
    <ul className="attachment-list">{sources.map((file,i)=><li key={i}><span className="attachment-name">{file.name}</span><button className="btn text" type="button" onClick={()=>setSources(files=>files.filter((_,n)=>n!==i))}>添付から外す</button></li>)}</ul>
    </fieldset>{savedId&&<p role="status">課題は保存済みです。添付だけを再試行できます。</p>}{error&&<p className="banner error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="btn outline" disabled={busy||reading} onClick={onClose}>{savedId?"閉じる":"キャンセル"}</button><button className="btn" disabled={busy||reading}>{busy?"保存しています…":savedId?"添付を再試行":"保存"}</button></div>
  </form></dialog>;
}

function SettingsPanel({data,busy,onSave,onSignOut}:{data:Snapshot;busy:boolean;onSave:(p:Preferences)=>Promise<void>;onSignOut:()=>Promise<void>}){
  const [p,setP]=useState<Preferences>(data.preferences??emptyPreferences);
  return <div className="settings-layout"><div><section className="settings-section"><h2>通知を受け取る条件</h2><h3>通知を受け取りたい友達</h3>{data.members.length===1&&<p className="support">他のメンバーはまだいません。</p>}{data.members.filter(m=>m.id!==data.user.id).map(m=><label className="check-line" key={m.id}><input type="checkbox" checked={p.friends.includes(m.id)} onChange={e=>setP({...p,friends:e.target.checked?[...p.friends,m.id]:p.friends.filter(id=>id!==m.id)})}/>{m.name}</label>)}<h3>クラス全体の提出</h3>{([["first","最初の1人が提出"],["half","半分が提出"],["twoThirds","3分の2が提出"],["allOthers","自分以外全員が提出"]] as const).map(([key,label])=><label className="check-line" key={key}><input type="checkbox" checked={p[key]} onChange={e=>setP({...p,[key]:e.target.checked})}/>{label}</label>)}<button className="btn" disabled={busy} onClick={()=>void onSave(p)}>通知設定を保存</button></section>
    {data.user.role==="admin"&&<InvitationSettings/>}<section className="settings-section"><h2>アカウント</h2><dl className="detail-meta"><div><dt>表示名</dt><dd>{data.user.name}</dd></div><div><dt>ID</dt><dd>{data.user.username}</dd></div></dl><button className="btn outline" disabled={busy} onClick={()=>void onSignOut()}>ログアウト</button><p className="support">ログアウトすると、この端末への通知も停止します。</p></section></div><PushSettings/></div>;
}
type Device={id:string;label:string;last_result:string|null;enabled:number;currentDevice:number};
function PushSettings(){
  const [devices,setDevices]=useState<Device[]>([]),[selected,setSelected]=useState(""),[label,setLabel]=useState("この端末"),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[supported,setSupported]=useState(false),[installed,setInstalled]=useState(false),[ios,setIos]=useState(false);
  const refresh=useCallback(async()=>{const d=await api<{devices:Device[]}>("/api/push");setDevices(d.devices);setSelected(prev=>d.devices.some(x=>x.id===prev)?prev:d.devices[0]?.id??"");},[]);
  useEffect(()=>{Promise.resolve().then(()=>{setSupported("Notification" in window&&"PushManager" in window&&"serviceWorker" in navigator);setInstalled(matchMedia("(display-mode: standalone)").matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);setIos(/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1));return refresh();}).catch(e=>setError(e.message));},[refresh]);
  async function enable(){if(busy)return;setBusy(true);setError("");setMessage("");try{
    const permission=await Notification.requestPermission();if(permission!=="granted")throw new Error("端末の設定で通知を許可してください。");
    const reg=await navigator.serviceWorker.ready,d=await api<{publicKey:string}>("/api/push"),key=Uint8Array.from(atob(d.publicKey.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
    const sub=await reg.pushManager.getSubscription()??await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await api("/api/push",{label,subscription:sub.toJSON()});await refresh();setMessage("通知を有効にしました。");
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function send(){setBusy(true);setError("");setMessage("");try{await api("/api/push/send",{id:selected});setMessage("テスト通知の送信を受け付けました。");}catch(e){setError((e as Error).message);}finally{await refresh().catch(()=>{});setBusy(false);}}
  async function disable(){setBusy(true);setError("");try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub)await api("/api/push",{endpoint:sub.endpoint},"DELETE");await refresh();setMessage("この端末の通知登録を解除しました。");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section className="settings-section push-panel"><h2>端末の通知</h2><label>端末名<input value={label} maxLength={40} onChange={e=>setLabel(e.target.value)}/></label><button className="btn full" disabled={busy||!supported||(ios&&!installed)||!label.trim()} onClick={()=>void enable()}>この端末を登録</button>{ios&&!installed&&<p className="support">Safariの共有メニューで「ホーム画面に追加」し、そのアイコンから開いてください。</p>}{!supported&&<p className="support">このブラウザでは通知機能を利用できません。</p>}
    <div className="section-heading"><h3>テスト通知</h3><button className="btn text" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>更新</button></div><label>送信先<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={!devices.length||busy}>{!devices.length&&<option value="">登録した端末はありません</option>}{devices.map(d=><option value={d.id} key={d.id}>{d.label}{d.currentDevice?"（この端末）":""}</option>)}</select></label><button className="btn outline full" disabled={busy||!selected} onClick={()=>void send()}>テスト通知を送る</button>{devices.some(d=>d.currentDevice)&&<button className="btn text" disabled={busy} onClick={()=>void disable()}>この端末の登録を解除</button>}{error&&<p className="banner error" role="alert">{error}</p>}{message&&<p className="banner success" role="status">{message}</p>}
  </section>;
}
