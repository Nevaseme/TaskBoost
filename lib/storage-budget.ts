import { HttpError } from "./app-server";
import { createHash } from "node:crypto";
import { finishDeletion } from "./deletion-cleanup";

const unavailable = () => new HttpError(503, "添付の利用上限に達したか、安全確認のため停止しています。時間をおいてお試しください。");

// Reviewed definitions from migration 0005. Names alone would accept a broken
// replacement trigger. Check each operation; never cache across DB restores.
const triggerHashes: Record<string,string> = {
  storage_reserve_before: "ca4bd7fa5d2908ac71de64479577b88b66fb8a39a31584c9e95e4b18db3cf748",
  storage_reserve_after: "4574e18af404fb5c4ccd1b4840cd25450e8c56880cd08bc20973cd69f5611827",
  storage_release: "6383158bae271b8169e295b5dea53fe5b220876c1671a47c74900b52fee84b94",
};
async function verifySchema(db: D1Database, epoch: string | undefined) {
  try {
    if (!epoch) throw unavailable();
    const active = await db.prepare("SELECT id FROM storage_budget WHERE id=1 AND enabled=1 AND epoch=? AND day<=strftime('%Y-%m-%d','now')").bind(epoch).first();
    if (!active) throw unavailable();
    const {results} = await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('storage_reserve_before','storage_reserve_after','storage_release')").all<{name:string;sql:string}>();
    if (results.length !== 3 || results.some(row => createHash("sha256").update(row.sql.trim().replace(/;$/, "").replace(/\s+/g," ")).digest("hex") !== triggerHashes[row.name])) throw unavailable();
  } catch { throw unavailable(); }
}

async function reserveOperation(db: D1Database, kind: "read" | "write") {
  const reads = kind === "read" ? 1 : 0, writes = kind === "write" ? 1 : 0;
  try {
    const row = await db.prepare(`UPDATE storage_budget SET
      writes_today=CASE WHEN day=strftime('%Y-%m-%d','now') THEN writes_today+? ELSE ? END,
      reads_today=CASE WHEN day=strftime('%Y-%m-%d','now') THEN reads_today+? ELSE ? END,
      day=strftime('%Y-%m-%d','now')
      WHERE id=1 AND enabled=1 AND day<=strftime('%Y-%m-%d','now')
      AND (day<strftime('%Y-%m-%d','now') OR (writes_today+?<=300 AND reads_today+?<=3000))
      RETURNING id`).bind(writes,writes,reads,reads,writes,reads).first();
    if (!row) throw unavailable();
  } catch { throw unavailable(); }
}

async function reserveLimit(db: D1Database, key: string, period: number, limit: number, error: HttpError) {
  let row;
  try {
    row = await db.prepare(`INSERT INTO storage_operation_limits(key,window,count) VALUES(?,CAST(unixepoch()/? AS INTEGER),1)
      ON CONFLICT(key) DO UPDATE SET window=excluded.window,
        count=CASE WHEN storage_operation_limits.window=excluded.window THEN storage_operation_limits.count+1 ELSE 1 END
      WHERE storage_operation_limits.window<=excluded.window
        AND (storage_operation_limits.window<excluded.window OR storage_operation_limits.count<?)
      RETURNING key,window`).bind(key,period,limit).first<{key:string;window:number}>();
  } catch { throw unavailable(); }
  if (!row) throw error;
  return row.window;
}

/** Call after ownership checks and before accepting an upload body. */
export async function checkStorageAccess(db: D1Database, epoch: string | undefined, userId: string, kind: "read" | "write" | "delete") {
  await verifySchema(db,epoch);
  await reserveLimit(db,`user:${userId}:minute`,60,30,new HttpError(429,"添付の操作が続いています。1分ほど待ってからお試しください。"));
  const day=await reserveLimit(db,`user:${userId}:${kind}`,86400,{read:200,write:20,delete:30}[kind],new HttpError(429,"本日の添付の利用上限に達しました。日本時間の午前9時以降にお試しください。"));
  if (kind === "write") {
    // Exact bytes are reserved again after reading; this early gate rejects
    // stopped/full budgets without buffering or hashing the request body.
    const row = await db.prepare(`SELECT id FROM storage_budget WHERE id=1 AND enabled=1 AND epoch=?
      AND reserved_bytes<5000000000 AND (day<strftime('%Y-%m-%d','now') OR writes_today<300)`).bind(epoch).first();
    if (!row) throw unavailable();
  }
  return day;
}

/** All application R2 access must pass this gate; errors never refund operation counts. */
export function guardedStorage(db: D1Database, bucket: R2Bucket, epoch: string | undefined) {
  return {
    async put(key: string, bytes: Buffer, contentType: string, sha256: string, uploadDay?:number) {
      await verifySchema(db, epoch);
      let reserved;
      try {
        // The trigger reserves capacity and a write in the same SQL statement.
        reserved=await db.prepare(`INSERT INTO storage_reservations(storage_key,bytes)
          SELECT ?,? WHERE ? IS NULL OR CAST(unixepoch()/86400 AS INTEGER)=? RETURNING storage_key`)
          .bind(key,bytes.length,uploadDay??null,uploadDay??null).first();
      } catch { throw unavailable(); }
      if(!reserved)throw new HttpError(409,"利用回数の更新時刻を過ぎました。もう一度添付してください。");
      // A timeout may still have stored the file. Keep its reservation until a
      // later, confirmed removal; never automatically retry or refund this PUT.
      const object = await bucket.put(key, bytes, { storageClass: "Standard", httpMetadata: { contentType }, sha256 });
      if (!object) throw new HttpError(503, "添付の保存を確認できませんでした。");
    },
    async get(key: string) {
      await verifySchema(db, epoch);
      await reserveOperation(db, "read");
      return bucket.get(key);
    },
    async delete(key: string) {
      await verifySchema(db, epoch);
      // A separate bounded quota lets users free space after uploads stop.
      await reserveLimit(db,"global:delete",86400,300,unavailable());
      await bucket.delete(key);
      // A unique reservation makes repeated/concurrent deletes refund once.
      await finishDeletion(db.prepare("DELETE FROM storage_reservations WHERE storage_key=?").bind(key));
    },
  };
}
