import { snoozeTask, untickRoutineCluster } from "@/lib/api";

// Target of the action buttons on ntfy notifications ("Not done" on an auto-ticked routine,
// "Snooze 1 day" on a due task). Authenticated with the cron secret — the button's request is
// fired by the ntfy app, which has no session cookie. Exempted from session auth in proxy.ts.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  try {
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
