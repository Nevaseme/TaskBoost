import { sqliteTable, text, integer, uniqueIndex, primaryKey, index, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const storageBudget = sqliteTable("storage_budget", {
  id: integer("id").primaryKey(), enabled: integer("enabled").notNull().default(0),
  epoch: text("epoch").notNull().default(""),
  reservedBytes: integer("reserved_bytes").notNull().default(0), day: text("day").notNull(),
  writesToday: integer("writes_today").notNull().default(0), readsToday: integer("reads_today").notNull().default(0),
}, t => [check("storage_singleton", sql`${t.id}=1`),check("storage_enabled",sql`${t.enabled} IN (0,1)`),
  check("storage_nonnegative_bytes",sql`${t.reservedBytes}>=0`),check("storage_nonnegative_writes",sql`${t.writesToday}>=0`),check("storage_nonnegative_reads",sql`${t.readsToday}>=0`)]);
export const storageReservations = sqliteTable("storage_reservations", {
  storageKey: text("storage_key").primaryKey(), bytes: integer("bytes").notNull(),
  createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
}, t => [check("storage_file_bytes",sql`${t.bytes}>0 AND ${t.bytes}<=20971520`)]);
export const storageOperationLimits = sqliteTable("storage_operation_limits", {
  key: text("key").primaryKey(), window: integer("window").notNull(), count: integer("count").notNull(),
}, t => [check("storage_operation_count",sql`${t.count}>0`)]);

export const user = sqliteTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false), image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  username: text("username").unique(), displayUsername: text("displayUsername"), classId: text("classId").notNull().default("prototype"),
  role: text("role",{enum:["member","admin"]}).notNull().default("member"),
});
export const classInvitations=sqliteTable("class_invitations",{
  classId:text("class_id").primaryKey(),codeHash:text("code_hash").notNull(),createdAt:text("created_at").notNull(),createdBy:text("created_by").notNull().references(()=>user.id),
});
export const classes=sqliteTable("classes",{
  id:text("id").primaryKey(),name:text("name").notNull(),
});
export const session = sqliteTable("session", {
  id: text("id").primaryKey(), expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(), token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ipAddress"), userAgent: text("userAgent"), userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }),
});
export const account = sqliteTable("account", {
  id: text("id").primaryKey(), accountId: text("accountId").notNull(), providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade" }), accessToken: text("accessToken"), refreshToken: text("refreshToken"), idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }), refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }), scope: text("scope"), password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});
export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }), updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});
export const rateLimit = sqliteTable("rateLimit", { id: text("id").primaryKey(), key: text("key").notNull().unique(), count: integer("count").notNull(), lastRequest: integer("lastRequest").notNull() });
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(), label: text("label").notNull(), endpoint: text("endpoint").notNull().unique(), p256dh: text("p256dh").notNull(), auth: text("auth").notNull(), updatedAt: text("updated_at").notNull(), lastResult: text("last_result"),
  userId: text("user_id").references(() => user.id), sessionId: text("session_id"), enabled: integer("enabled").notNull().default(0),
});
export const assignments = sqliteTable("assignments", {
  submissionFormat: text("submission_format").notNull().default(""),
  id: text("id").primaryKey(), classId: text("class_id").notNull(), subject: text("subject").notNull(), title: text("title").notNull(), description: text("description").notNull(), deadline: text("deadline").notNull(), createdBy: text("created_by").notNull().references(() => user.id), createdAt: text("created_at").notNull(),
});
export const submissions = sqliteTable("submissions", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id), userId: text("user_id").notNull().references(() => user.id), submitted: integer("submitted").notNull(), updatedAt: text("updated_at").notNull(), operationId: text("operation_id").notNull(),
}, t => [primaryKey({ columns: [t.assignmentId, t.userId] })]);
export const assignmentFiles = sqliteTable("assignment_files", {
  id: text("id").primaryKey(), assignmentId: text("assignment_id").notNull().references(() => assignments.id),
  storageKey: text("storage_key").notNull().unique(), name: text("name").notNull(), contentType: text("content_type").notNull(),
  size: integer("size").notNull(), sha256: text("sha256").notNull(), createdBy: text("created_by").notNull().references(() => user.id), createdAt: text("created_at").notNull(),
}, t => [index("files_assignment").on(t.assignmentId)]);
export const aiRequests = sqliteTable("ai_requests", {
  id:text("id").primaryKey(),userId:text("user_id").notNull(),classId:text("class_id").notNull(),day:text("day").notNull(),
  status:text("status").notNull(),elapsedMs:integer("elapsed_ms"),usage:text("usage"),createdAt:text("created_at").notNull(),
},t=>[index("ai_requests_day_class").on(t.day,t.classId),index("ai_requests_day_user").on(t.day,t.userId)]);
export const aiStops = sqliteTable("ai_stops", { day:text("day").primaryKey(),reason:text("reason").notNull() });
export const reminderSettings = sqliteTable("reminder_settings", {
  assignmentId:text("assignment_id").notNull().references(()=>assignments.id),userId:text("user_id").notNull().references(()=>user.id),
  customAt:text("custom_at"),deadlineEnabled:integer("deadline_enabled").notNull().default(0),updatedAt:text("updated_at").notNull(),
},t=>[primaryKey({columns:[t.assignmentId,t.userId]})]);
export const reminderEvents = sqliteTable("reminder_events", {
  id:text("id").primaryKey(),operationId:text("operation_id").notNull(),assignmentId:text("assignment_id").notNull(),userId:text("user_id").notNull(),
  scheduledAt:text("scheduled_at").notNull(),reasons:text("reasons").notNull(),createdAt:text("created_at").notNull(),
},t=>[uniqueIndex("reminder_once_per_minute").on(t.assignmentId,t.userId,t.scheduledAt),index("reminder_operation").on(t.operationId)]);
export const assignmentSettings = sqliteTable("assignment_settings", {
  assignmentId: text("assignment_id").notNull().references(() => assignments.id), userId: text("user_id").notNull().references(() => user.id), importance: integer("importance").notNull().default(2), plannedFor: text("planned_for"),
}, t => [primaryKey({ columns: [t.assignmentId, t.userId] })]);
export const preferences = sqliteTable("preferences", {
  userId: text("user_id").primaryKey().references(() => user.id), first: integer("first").notNull().default(0), half: integer("half").notNull().default(0), twoThirds: integer("two_thirds").notNull().default(0), allOthers: integer("all_others").notNull().default(0),
});
export const watches = sqliteTable("watches", {
  userId: text("user_id").notNull().references(() => user.id), friendId: text("friend_id").notNull().references(() => user.id),
}, t => [primaryKey({ columns: [t.userId, t.friendId] })]);
export const notificationEvents = sqliteTable("notification_events", {
  dedupeKey: text("dedupe_key").primaryKey(), operationId: text("operation_id").notNull(), assignmentId: text("assignment_id").notNull(), recipientId: text("recipient_id").notNull(), kind: text("kind").notNull(),
}, t => [index("events_operation").on(t.operationId)]);
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(), operationId: text("operation_id").notNull(), assignmentId: text("assignment_id").notNull().references(() => assignments.id), recipientId: text("recipient_id").notNull().references(() => user.id), actorId: text("actor_id").notNull().references(() => user.id), reasons: text("reasons").notNull(), createdAt: text("created_at").notNull(), read: integer("read").notNull().default(0), pushStatus: text("push_status").notNull().default("pending"),
}, t => [uniqueIndex("notification_operation_recipient").on(t.operationId, t.recipientId), index("notifications_recipient").on(t.recipientId)]);
