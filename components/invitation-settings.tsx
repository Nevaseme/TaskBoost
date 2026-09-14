"use client";
import {useState} from 'react';

export function InvitationSettings(){
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  async function issue(){
    setBusy(true);setError('');setCopied(false);setCode('');
    try{
      const response=await fetch('/api/admin/invitation',{method:'POST',signal:AbortSignal.timeout(15000)});
      const data=await response.json() as {code:string;error?:string};if(!response.ok)throw new Error(data.error??'招待コードを発行できませんでした。');setCode(data.code);
    }catch(e){setError((e as Error).name==='TimeoutError'?'発行を確認できませんでした。もう一度発行してください。':(e as Error).message);}
    finally{setBusy(false);}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(`${window.location.origin}\n招待コード：${code}`);setCopied(true);}
    catch{setError('コードを選択してコピーしてください。');}
  }
  return <section className="settings-section"><h2>メンバーを招待</h2>
    <p className="support">発行すると以前のコードは使えなくなります。登録済みのメンバーには影響しません。</p>
    <button className="btn outline" disabled={busy} onClick={()=>void issue()}>{busy?'発行しています…':'招待コードを発行'}</button>
    {code&&<><label>招待コード<input readOnly value={code} onFocus={e=>e.currentTarget.select()}/></label><button className="btn outline" onClick={()=>void copy()}>URLとコードをコピー</button><p className="support">共有先で「新規登録」を選び、このコードを入力します。</p></>}
    {copied&&<p role="status">コピーしました。</p>}{error&&<p className="banner error" role="alert">{error}</p>}
  </section>;
}
