import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { apiError, HttpError, requireSession } from "./app-server";
import { bindings } from "./auth";
import { checkStorageAccess, guardedStorage } from "./storage-budget";
import { acquireInputSlot, readFileBody } from "./bounded-input";
import { finishDeletion } from "./deletion-cleanup";

export { MAX_FILE_BYTES } from "./bounded-input";
const types: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
export function validateFile(name: string, data: Buffer) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "", type = types[ext];
  const valid = ext === "pdf" ? data.subarray(0,5).toString() === "%PDF-"
    : ext === "png" ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : ext === "jpg" || ext === "jpeg" ? data[0] === 255 && data[1] === 216 && data[2] === 255
    : ext === "docx" ? data.length >= 4 && data.readUInt32LE(0) === 0x04034b50 && data.includes(Buffer.from("[Content_Types].xml")) && data.includes(Buffer.from("word/document.xml")) : false;
  if (!type || !valid) throw new HttpError(415, "PDF・DOCX・PNG・JPEGのファイルを選んでください。");
  return type;
}
type FileRow = { id: string; storage_key: string; name: string; content_type: string; size: number; sha256: string; created_at: string };
export async function handleFiles(request: Request) {
  let release:(()=>void)|undefined;
  try {
    const s = await requireSession(request), db = bindings().DB;
    const {BUCKET: bucket, STORAGE_EPOCH: epoch, STORAGE_DB: storageDb} = env as unknown as { BUCKET?: R2Bucket; STORAGE_EPOCH?: string; STORAGE_DB?: D1Database };
    if (!bucket) throw new HttpError(503, "添付の保存先を準備しています。");
    if (!storageDb) throw new HttpError(503, "添付は安全確認のため停止しています。");
    const storage = guardedStorage(storageDb, bucket, epoch);
    const url = new URL(request.url), [assignmentId, fileId] = url.pathname.replace(/^\/api\/files\//, "").split("/");
    const a = await db.prepare("SELECT id,created_by FROM assignments WHERE id=? AND class_id=?").bind(assignmentId,s.user.classId).first<{id:string;created_by:string}>();
    if (!a) throw new HttpError(404, "課題が見つかりません。");
    if (request.method !== "GET" && a.created_by !== s.user.id && s.user.role!=="admin") throw new HttpError(403, "添付を変更できるのは課題の登録者と管理者です。");
    if (request.method === "GET" && !fileId) {
      const files = await db.prepare("SELECT id,name,content_type AS contentType,size,sha256,created_at AS createdAt FROM assignment_files WHERE assignment_id=? ORDER BY created_at").bind(a.id).all();
      return Response.json({ files: files.results }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && !fileId) {
      const uploadDay=await checkStorageAccess(storageDb,epoch,s.user.id,"write");
      release=acquireInputSlot();
      let name: string;
      try { name = decodeURIComponent(request.headers.get("x-file-name") ?? "").trim(); } catch { throw new HttpError(400,"ファイル名を確認してください。"); }
      if (!name || name.length > 200 || /[\x00-\x1f/\\]/.test(name)) throw new HttpError(400,"ファイル名を確認してください。");
      const count = await db.prepare("SELECT count(*) AS n FROM assignment_files WHERE assignment_id=?").bind(a.id).first<{n:number}>();
      if (!count || count.n >= 5) throw new HttpError(409,"添付は1課題につき5件までです。");
      const bytes = await readFileBody(request), type = validateFile(name,bytes), id = crypto.randomUUID(), key = `assignments/${a.id}/${id}`;
      const hash = createHash("sha256").update(bytes).digest("hex");
      await storage.put(key,bytes,type,hash,uploadDay);
      // D1 serializes this conditional INSERT, including simultaneous uploads.
      // An uncertain response retains its reservation; it may have committed.
      const inserted = await db.prepare(`INSERT INTO assignment_files(id,assignment_id,storage_key,name,content_type,size,sha256,created_by,created_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM assignments WHERE id=?) AND (SELECT count(*) FROM assignment_files WHERE assignment_id=?)<5 RETURNING id`)
        .bind(id,a.id,key,name,type,bytes.length,hash,s.user.id,new Date().toISOString(),a.id,a.id).first();
      if (!inserted) {
        try{await storage.delete(key);}
        catch(error){
          console.error(JSON.stringify({event:"attachment_cleanup_failed",key,error:error instanceof Error?error.name:"unknown"}));
          throw new HttpError(503,"添付の後処理を確認できませんでした。時間をおいてお試しください。");
        }
        throw new HttpError(409,"課題が削除されたか、添付が5件に達しました。再読み込みしてください。");
      }
      return Response.json({ id, sha256: hash, size: bytes.length },{status:201});
    }
    const f = await db.prepare("SELECT * FROM assignment_files WHERE id=? AND assignment_id=?").bind(fileId??"",a.id).first<FileRow>();
    if (!f) throw new HttpError(404,"添付が見つかりません。");
    if (request.method === "DELETE") {
      await checkStorageAccess(storageDb,epoch,s.user.id,"delete");
      await storage.delete(f.storage_key);
      await finishDeletion(db.prepare("DELETE FROM assignment_files WHERE id=? AND assignment_id=?").bind(f.id,a.id));
      return Response.json({ deleted: true });
    }
    if (request.method !== "GET") throw new HttpError(405,"この操作は利用できません。");
    await checkStorageAccess(storageDb,epoch,s.user.id,"read");
    const object = await storage.get(f.storage_key);
    if (!object) throw new HttpError(503,"添付を取得できません。登録した人に再添付を依頼してください。");
    const disposition = url.searchParams.has("download") || f.content_type.includes("wordprocessingml") ? "attachment" : "inline";
    return new Response(object.body, { headers: {
      "Content-Type": f.content_type, "Content-Length": String(f.size), "X-Content-SHA256": f.sha256,
      "Content-Disposition": `${disposition}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(f.name).replace(/'/g,"%27")}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox",
    } });
  } catch (error) { return apiError(error); }
  finally { release?.(); }
}
