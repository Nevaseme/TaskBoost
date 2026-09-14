"use client";
import {useState,type FormEvent} from 'react';

async function save(path:string,method:string,body:unknown){
  const response=await fetch(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json() as {code?:string;error?:string};
  if(!response.ok)throw new Error(data.code==='INVALID_PASSWORD'?'現在のパスワードが違います。':data.error??'変更できませんでした。入力内容を確認してください。');
}
export function AccountSettings({name,username,onSaved,onPasswordChanged}:{name:string;username:string;onSaved:()=>Promise<void>;onPasswordChanged:()=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>,password=false){
    e.preventDefault();const form=e.currentTarget,f=new FormData(form);setError('');setNotice('');
    if(password&&f.get('newPassword')!==f.get('confirmPassword')){setError('新しいパスワードが一致していません。');return;}
    setBusy(true);
    try{
      await save(password?'/api/auth/change-password':'/api/app/profile',password?'POST':'PUT',password?{currentPassword:f.get('currentPassword'),newPassword:f.get('newPassword'),revokeOtherSessions:true}:{name:f.get('name')});
      if(password){form.reset();await onPasswordChanged();setNotice('パスワードを変更しました。通知を使う端末は再登録してください。');}
      else{await onSaved();setNotice('表示名を変更しました。');}
    }catch(e){setError((e as Error).name==='TimeoutError'?'変更を確認できませんでした。再ログインして確認してください。':(e as Error).message);}
    finally{setBusy(false);}
  }
  return <><p className="support">ID：{username}</p>
    <form onSubmit={e=>void submit(e)}><label>表示名<input name="name" defaultValue={name} required maxLength={40} autoComplete="nickname"/></label><button className="btn outline" disabled={busy}>表示名を保存</button></form>
    <details><summary>パスワードを変更</summary><form onSubmit={e=>void submit(e,true)}>
      <label>現在のパスワード<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>
      <label>新しいパスワード<input name="newPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128}/></label>
      <p className="support">10〜128文字。他の端末はログアウトします。</p>
      <label>新しいパスワード（確認）<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={128}/></label>
      <button className="btn outline" disabled={busy}>パスワードを変更</button>
    </form></details>
    {error&&<p className="banner error" role="alert">{error}</p>}{notice&&<p className="banner success" role="status">{notice}</p>}
  </>;
}
