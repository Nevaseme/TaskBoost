"use client";

// Reuse the PDF viewer already shipped with the app. Do not discard image-only
// pages: such documents keep the existing server-side conversion route.
export async function pdfText(file:File,signal:AbortSignal):Promise<string|null>{
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="/pdfjs/pdf.worker.min.mjs";
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),cMapUrl:"/pdfjs/cmaps/",cMapPacked:true,standardFontDataUrl:"/pdfjs/standard_fonts/",useWasm:false});
  const stop=()=>{void task.destroy();};signal.addEventListener("abort",stop,{once:true});
  try{
    signal.throwIfAborted();const doc=await task.promise;let text="";
    for(let number=1;number<=doc.numPages;number++){
      signal.throwIfAborted();const page=await doc.getPage(number);
      const content=await page.getTextContent();
      const pageText=content.items.map(item=>"str" in item?item.str+(item.hasEOL?"\n":" "):"").join("").trim();
      if(!pageText)return null;
      // Diagrams and scanned pages can carry essential assignment instructions.
      const operators=await page.getOperatorList();
      if(operators.fnArray.some(op=>[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageMaskXObject].includes(op)))return null;
      text+=`\n${pageText}\n`;
      if(text.length>20000)throw new Error("文書が長すぎます。2万文字以内の資料か手入力をお試しください。");
      page.cleanup();
    }
    return text.trim()||null;
  }finally{signal.removeEventListener("abort",stop);await task.destroy();}
}
