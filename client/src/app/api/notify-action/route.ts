import { auth } from "@/auth";
import { completeRoutineCluster, snoozeTask, untickRoutineCluster } from "@/lib/api";

// Target of the action buttons on notifications ("Done" on a due routine, "Snooze 1 day" on a
// due task). Two callers, two kinds of auth:
//  - the ntfy app, which has no session cookie, sends the cron secret as a bearer token;
//  - Cura's own service worker (Web Push buttons, where the platform shows them) is same-origin
//    and sends the session cookie.
// Exempted from the session redirect in proxy.ts so the first kind can reach it at all.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const bySecret = !!secret && authHeader === `Bearer ${secret}`;
  if (!bySecret && !(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  try {
    if (kind === "complete-routine") {
      await completeRoutineCluster(id);
      return Response.json({ ok: true });
    }
    if (kind === "untick-routine") {
      await untickRoutineCluster(id);
      return Response.json({ ok: true });
    }
    if (kind === "snooze-task") {
      const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "1") || 1, 1), 30);
      await snoozeTask(id, days);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Unknown kind" }, { status: 400 });
  } catch (err) {
    console.error("[notify-action] failed:", err);
    return Response.json({ error: "Action failed" }, { status: 500 });
  }
}
