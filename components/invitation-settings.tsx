"use client";
import {useState} from 'react';

export function InvitationSettings({className,onSaved}:{className:string;onSaved:()=>Promise<void>}){
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const [name,setName]=useState(className),[issuedName,setIssuedName]=useState(''),[saved,setSaved]=useState(false);
  async function saveName(){
    setBusy(true);setError('');setSaved(false);
    try{const response=await fetch('/api/app/class',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({name}),signal:AbortSignal.timeout(15000)});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error??'保存できませんでした。');await onSaved();setSaved(true);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function issue(){
    setBusy(true);setError('');setCopied(false);setCode('');
    try{
      const response=await fetch('/api/admin/invitation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({className:name}),signal:AbortSignal.timeout(15000)});
      const data=await response.json() as {code:string;className:string;error?:string};if(!response.ok)throw new Error(data.error??'招待コードを発行できませんでした。');setCode(data.code);setIssuedName(data.className);await onSaved();
    }catch(e){setError((e as Error).name==='TimeoutError'?'発行を確認できませんでした。もう一度発行してください。':(e as Error).message);}
    finally{setBusy(false);}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(`${issuedName}\n${window.location.origin}\n招待コード：${code}`);setCopied(true);}
    catch{setError('コードを選択してコピーしてください。');}
  }
  return <section className="settings-section"><h2>クラスと招待</h2>
    <label>チーム／クラス名<input value={name} maxLength={60} onChange={e=>{setName(e.target.value);setSaved(false);}} disabled={busy}/></label>
    <button className="btn outline" disabled={busy||!name.trim()} onClick={()=>void saveName()}>名前を保存</button>{saved&&<p role="status">保存しました。</p>}
    <h3>メンバーを招待</h3>
    <p className="support">発行すると以前のコードは使えなくなります。登録済みのメンバーには影響しません。</p>
    <button className="btn outline" disabled={busy||!name.trim()} onClick={()=>void issue()}>招待コードを発行</button>
    {code&&<><label>招待コード<input readOnly value={code} onFocus={e=>e.currentTarget.select()}/></label><button className="btn outline" onClick={()=>void copy()}>URLとコードをコピー</button><p className="support">共有先で「新規登録」を選び、このコードを入力します。</p></>}
    {copied&&<p role="status">コピーしました。</p>}{error&&<p className="banner error" role="alert">{error}</p>}
  </section>;
}
