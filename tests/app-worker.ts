import * as appRoute from "../app/api/app/[[...path]]/route";
import { auth } from "../lib/auth";
import { handlePush } from "../lib/push-api";
import { handleFiles } from "../lib/file-api";
import { handleAiDraft } from "../lib/ai-draft";
import { handleReminders } from "../lib/reminders";
import { handleReminderTick } from "../lib/reminder-tick";
import { handleInvitation } from "../lib/invitations";
export default {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/auth/")) return auth().handler(request);
    if (path === "/api/admin/invitation") return handleInvitation(request);
    if (path.startsWith("/api/push")) return handlePush(request);
    if (path.startsWith("/api/files/")) return handleFiles(request);
    if (path === "/api/ai/draft") return handleAiDraft(request);
    if (path === "/__test/abort-ai") {
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),200);
      try{return await handleAiDraft(new Request(request,{signal:controller.signal}));}
      finally{clearTimeout(timer);}
    }
    if (path.startsWith("/api/reminders/")) return handleReminders(request);
    if (path === "/api/internal/reminders/tick") return handleReminderTick(request);
    const handler=(appRoute as Record<string,(request:Request)=>Promise<Response>>)[request.method];
    return handler?handler(request):new Response(null,{status:405});
  },
};
