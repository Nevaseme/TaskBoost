import { env } from "cloudflare:workers";
import { guardedStorage } from "../lib/storage-budget";
import { apiError } from "../lib/app-server";

let puts=0, gets=0, deletes=0;
const worker = { async fetch(request: Request) {
  if (request.method === "GET") return Response.json({puts,gets,deletes});
  const body = await request.json() as {op:string;key:string;fail?:boolean;epoch?:string;cleanupFailures?:number;committed?:boolean;uploadDay?:number};
  const bucket = {
    async put(_key: string, _data: unknown, options: {storageClass:string}) {
      puts++;
      if (options.storageClass !== "Standard") throw new Error("Wrong storage class");
      if (body.fail) throw new Error("Acknowledgement lost after upload");
      return {};
    },
    async get() { gets++; if (body.fail) throw new Error("Read failed"); return {}; },
    async delete() { deletes++; if (body.fail) throw new Error("Delete failed"); },
  } as unknown as R2Bucket;
  const original = (env as unknown as {DB:D1Database}).DB;
  let failures=body.cleanupFailures??0;
  const db = new Proxy(original,{get(target,prop){
    if(prop==='prepare')return (sql:string)=>{
      const statement=target.prepare(sql);
      if(!sql.startsWith('DELETE FROM storage_reservations'))return statement;
      function wrap(value:D1PreparedStatement):D1PreparedStatement{return new Proxy(value,{get(stmt,key){
        if(key==='bind')return (...args:unknown[])=>wrap(stmt.bind(...args));
        if(key==='run')return async()=>{if(failures-->0){if(body.committed)await stmt.run();throw new Error('Cleanup response lost');}return stmt.run();};
        const fn=Reflect.get(stmt,key);return typeof fn==='function'?fn.bind(stmt):fn;
      }});}
      return wrap(statement);
    };
    const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;
  }});
  const storage = guardedStorage(db,bucket,body.epoch);
  try {
    if (body.op === "put") await storage.put(body.key,Buffer.alloc(20),"application/pdf","hash",body.uploadDay);
    else if (body.op === "get") await storage.get(body.key);
    else if (body.op === "delete") await storage.delete(body.key);
    else return new Response(null,{status:400});
    return Response.json({ok:true});
  } catch(error) { return apiError(error); }
}};
export default worker;
