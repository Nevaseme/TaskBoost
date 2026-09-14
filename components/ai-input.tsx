"use client";
import { useState } from "react";
import { pdfText } from "./pdf-text";
export type AiDraft={subject:string;title:string;description:string;submissionFormat:string;deadlineDate:string;deadlineTime:string};
async function imageCopy(file:File){
  const url=URL.createObjectURL(file);
  try{
    const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error("画像を開けませんでした。"));img.src=url;});
    const scale=Math.min(1,2048/Math.max(image.width,image.height)),canvas=document.createElement("canvas");
    canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    const ctx=canvas.getContext("2d");if(!ctx)throw new Error("画像の準備に失敗しました。");
    ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("画像の準備に失敗しました。")),"image/jpeg",0.9));
    return new File([blob],"reading-copy.jpg",{type:"image/jpeg"});
  }finally{URL.revokeObjectURL(url);}
}
export function AiInput({disabled,onDraft,onBusy}:{disabled:boolean;onDraft:(draft:AiDraft,file:File)=>void;onBusy:(busy:boolean)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState("");
  async function read(file?:File){if(!file)return;setBusy(true);onBusy(true);setError("");
    try{
      if(file.size>20*1024*1024)throw new Error("元資料は20MiB以下にしてください。");
      let text:string|null=null;
      if(/\.pdf$/i.test(file.name)){
        setProgress("PDFの文字を読み取っています…");
        try{text=await pdfText(file,AbortSignal.timeout(10000));}catch(e){if(e instanceof Error&&e.message.includes("2万文字"))throw e;}
      }
      setProgress("下書きを作成しています…（最大60秒）");
      const copy=/\.(png|jpe?g)$/i.test(file.name)?await imageCopy(file):file;
      const r=await fetch("/api/ai/draft",{method:"POST",headers:{"x-file-name":encodeURIComponent(copy.name),"content-type":text?"application/json":"application/octet-stream"},body:text?JSON.stringify({documentText:text,sourceName:file.name}):copy,signal:AbortSignal.timeout(65000)});
      const result=await r.json() as {draft:AiDraft;error?:string};if(!r.ok)throw new Error(result.error??"読み取りに失敗しました。");
      onDraft(result.draft,file);
    }catch(e){setError(e instanceof Error&&e.name!=="TimeoutError"?e.message:"時間内に読み取れませんでした。手入力で登録できます。");}finally{setBusy(false);onBusy(false);}
  }
  return <div className="personal-settings"><label>写真・ファイルから読み取る<input type="file" accept=".png,.jpg,.jpeg,.pdf,.docx" disabled={disabled||busy} onChange={e=>{void read(e.target.files?.[0]);e.target.value="";}}/></label><p className="support">資料をCloudflareへ送信します。元資料は課題に添付されます。</p>{busy&&<p role="status">{progress}</p>}{error&&<p className="banner error" role="alert">{error}</p>}</div>;
}
