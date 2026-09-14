export type Member = { id: string; name: string; username: string };
export type Assignment = { id: string; subject: string; title: string; description: string; submissionFormat: string; deadline: string; createdBy: string; creatorName: string; importance: number; plannedFor: string | null; submitted: number; submittedCount: number };
export type Preferences = { first: boolean; half: boolean; twoThirds: boolean; allOthers: boolean; friends: string[] };
export type AppNotification = { id: string; assignmentId: string; title: string; actorName: string; reasons: string; createdAt: string; read: number; pushStatus: string };
export type Snapshot = { className:string; user: Member & {role:string}; members: Member[]; assignments: Assignment[]; submissions: { assignmentId: string; userId: string; updatedAt: string }[]; preferences: Preferences; notifications: AppNotification[] };
export const reasonLabels: Record<string, string> = { friend: "選んだ友達が提出", first: "最初の1人が提出", half: "半分が提出", two_thirds: "3分の2が提出", all_others: "自分以外全員が提出", reminder_custom:"指定日時", reminder_deadline:"締切1時間前" };
export const emptyPreferences: Preferences = { first: false, half: false, twoThirds: false, allOthers: false, friends: [] };
export const todayJst = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
