import { markCronRun, sweepDayPlanBlocks, sweepDismissedCalendarEvents } from "@/lib/api";
import { checkAndNotifyDueItems } from "@/lib/notifications";

// Hit on a short interval (e.g. every minute) by an external scheduler — see the project's
// notification setup notes for why this isn't Vercel's own Cron (Hobby plan caps it at 1/day).
// Authenticated with a shared secret rather than a user session since the caller is a machine.
export async function GET(request: Request) {
  // Guard against a missing secret: without this, an unset CRON_SECRET would make the expected
  // header literally "Bearer undefined", which any caller could send to pass the check.
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [result] = await Promise.all([
    checkAndNotifyDueItems(),
    // Heartbeat: the UI warns when this stamp goes stale (external scheduler lapsed).
    markCronRun(now),
    // Housekeeping that used to run a delete on the page-load read path.
    sweepDismissedCalendarEvents(),
    sweepDayPlanBlocks(),
  ]);
  return Response.json(result);
}
