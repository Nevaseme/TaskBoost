"use client";
import { useEffect,useRef,useState } from "react";
import type { PDFDocumentProxy,RenderTask } from "pdfjs-dist";

export function PdfPreview({url}:{url:string}){
  const canvas=useRef<HTMLCanvasElement>(null),rendering=useRef<RenderTask|null>(null);
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[error,setError]=useState("");
  useEffect(()=>{
    let active=true,destroy:(()=>void)|undefined;
    void import("pdfjs-dist/legacy/build/pdf.mjs").then(async lib=>{
      if(!active)return;lib.GlobalWorkerOptions.workerSrc="/pdfjs/pdf.worker.min.mjs";
      const loading=lib.getDocument({url,cMapUrl:"/pdfjs/cmaps/",cMapPacked:true,standardFontDataUrl:"/pdfjs/standard_fonts/",useWasm:false});
      destroy=()=>{void loading.destroy();};const doc=await loading.promise;if(active)setPdf(doc);
    }).catch(()=>{if(active)setError("PDFのプレビューを表示できません。ダウンロードして確認してください。");});
    return()=>{active=false;destroy?.();};
  },[url]);
  useEffect(()=>{
    let active=true,task:RenderTask|undefined;
    void (async()=>{
      if(!pdf||!canvas.current)return;
      const previous=rendering.current;previous?.cancel();await previous?.promise.catch(()=>{});
      const p=await pdf.getPage(page);if(!active||!canvas.current)return;
      const base=p.getViewport({scale:1}),width=canvas.current.parentElement?.clientWidth??700;
      const scale=Math.min(2,width*Math.min(window.devicePixelRatio||1,2)/base.width,2400/base.height);
      const viewport=p.getViewport({scale});canvas.current.width=Math.ceil(viewport.width);canvas.current.height=Math.ceil(viewport.height);
      task=p.render({canvas:canvas.current,viewport});rendering.current=task;await task.promise;
    })().catch(e=>{if(active&&e?.name!=="RenderingCancelledException")setError("このページを表示できません。ダウンロードして確認してください。");});
    return()=>{active=false;task?.cancel();};
  },[pdf,page]);
  return <div className="pdf-preview">{error?<p role="alert">{error}</p>:<>{!pdf&&<p role="status">PDFを表示しています…</p>}{pdf&&<div className="attachment-actions pdf-pages"><button className="btn outline" type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>前のページ</button><span>{page} / {pdf.numPages} ページ</span><button className="btn outline" type="button" disabled={page>=pdf.numPages} onClick={()=>setPage(p=>p+1)}>次のページ</button></div>}<canvas ref={canvas} aria-label={`PDF ${page}ページ目`} style={{width:"100%",height:"auto"}}/></>}</div>;
}
