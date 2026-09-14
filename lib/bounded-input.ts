import {HttpError} from './app-server';

export const MAX_FILE_BYTES=20*1024*1024;
let occupied=false;

// This is an isolate memory guard. Persistent storage/AI quotas remain in D1.
export function acquireInputSlot(){
  if(occupied)throw new HttpError(429,'別の資料を処理しています。少し待ってからお試しください。');
  occupied=true;
  let released=false;
  return ()=>{if(!released){released=true;occupied=false;}};
}

export async function readFileBody(request:Request,maxBytes=MAX_FILE_BYTES,timeoutMs=30000){
  const tooLarge=()=>new HttpError(413,maxBytes===MAX_FILE_BYTES?'ファイルは20MiB以下にしてください。':'読み取る資料のサイズを小さくしてください。');
  if(Number(request.headers.get('content-length'))>maxBytes){void request.body?.cancel().catch(()=>{});throw tooLarge();}
  if(!request.body)throw new HttpError(400,'ファイルを選んでください。');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];
  let size=0,abort!:()=>void;
  const interrupted=new Promise<never>((_,reject)=>{abort=()=>{
    void reader.cancel().catch(()=>{});
    reject(new HttpError(408,'資料の送信が完了しませんでした。もう一度お試しください。'));
  };});
  const timer=setTimeout(abort,timeoutMs);
  request.signal.addEventListener('abort',abort,{once:true});
  if(request.signal.aborted)abort();
  try{
    while(true){
      const {done,value}=await Promise.race([reader.read(),interrupted]);
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes){void reader.cancel().catch(()=>{});throw tooLarge();}
      chunks.push(value);
    }
    if(!size)throw new HttpError(400,'空のファイルは添付できません。');
    return Buffer.concat(chunks,size);
  }finally{
    clearTimeout(timer);request.signal.removeEventListener('abort',abort);chunks.length=0;reader.releaseLock();
  }
}
