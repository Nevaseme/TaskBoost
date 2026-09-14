import {readFileBody,acquireInputSlot} from '../lib/bounded-input';
import {apiError} from '../lib/app-server';

const worker={async fetch(request:Request){
  const scenario=new URL(request.url).pathname;
  let cancelled=false;
  try{
    if(scenario==='/slot'){
      const release=acquireInputSlot();
      try{acquireInputSlot();return new Response('overlap allowed',{status:500});}
      catch(error){release();release();const next=acquireInputSlot();next();return apiError(error);}
    }
    const controller=new AbortController();
    const body=new ReadableStream<Uint8Array>({start(c){
      if(scenario==='/overflow'){c.enqueue(new Uint8Array(9));}
      if(scenario==='/complete'){c.enqueue(new Uint8Array([1,2,3]));c.close();}
    },cancel(){cancelled=true;}});
    const input=new Request('https://test.local',{method:'POST',body,signal:controller.signal,headers:scenario==='/header'?{'content-length':'9'}:{}});
    if(scenario==='/abort')controller.abort();
    try{return Response.json({bytes:[...await readFileBody(input,8,25)]});}
    catch(error){const response=apiError(error);return Response.json({cancelled},{status:response.status});}
  }catch(error){return apiError(error);}
}};
export default worker;
