import { auth } from "@/auth";
import { countCompletionsSince, getAppSettings, getCompletionLogs } from "@/lib/api";
import { getTimeZoneOffsetMs } from "@/lib/taskbookDates";

// Paged completion history for the Logbook modal, plus the "completed this week" stat.
// Session-authenticated via proxy.ts; the explicit check here is belt-and-braces.
export async function GET(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;

  const { timeZone } = await getAppSettings();
  // Start of the current week (Monday 00:00) in the configured zone, as a real instant.
  const now = new Date();
  const offset = getTimeZoneOffsetMs(now, timeZone);
  const local = new Date(now.getTime() + offset);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const weekStartLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday);
  const weekStart = new Date(weekStartLocal - offset);

  const [items, weekCount] = await Promise.all([
    getCompletionLogs({ before, limit: 100 }),
    countCompletionsSince(weekStart),
  ]);

  return Response.json({
    weekCount,
    items: items.map((i) => ({
      id: i.id,
      entityType: i.entityType,
      entityId: i.entityId,
      title: i.title,
      completedAt: i.completedAt.toISOString(),
      auto: i.auto,
    })),
  });
}
