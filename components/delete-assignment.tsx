"use client";
import {useEffect,useRef,useState} from 'react';

export function DeleteAssignment({id,title,onDeleted}:{id:string;title:string;onDeleted:()=>Promise<void>}){
  const [open,setOpen]=useState(false);
  return <><button className="btn text danger" onClick={()=>setOpen(true)}>削除する</button>{open&&<ConfirmDelete id={id} title={title} onCancel={()=>setOpen(false)} onDeleted={onDeleted}/>}</>;
}
function ConfirmDelete({id,title,onCancel,onDeleted}:{id:string;title:string;onCancel:()=>void;onDeleted:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close();},[]);
  async function remove(){
    setBusy(true);setError('');
    try{const r=await fetch('/api/app/assignments/'+id,{method:'DELETE',signal:AbortSignal.timeout(30000)});const data=await r.json() as {error?:string};if(!r.ok)throw new Error(data.error??'削除できませんでした。');await onDeleted();}
    catch(e){setError((e as Error).name==='TimeoutError'?'削除を確認できませんでした。閉じて再読み込みしてください。':(e as Error).message);setBusy(false);}
  }
  return <dialog ref={dialog} aria-labelledby="delete-title" onCancel={e=>{if(busy)e.preventDefault();else onCancel();}}>
    <h2 id="delete-title">課題を削除</h2><p>「{title}」を削除します。添付・提出状況・通知設定も削除され、元に戻せません。</p>
    {error&&<p className="banner error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="btn outline" disabled={busy} onClick={onCancel}>キャンセル</button><button className="btn danger" disabled={busy} onClick={()=>void remove()}>{busy?'削除しています…':'削除する'}</button></div>
  </dialog>;
}
