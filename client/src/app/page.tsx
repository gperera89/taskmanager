import { getPageSnapshot } from "@/lib/api";
import { formatLongDate } from "@/lib/taskbookDates";
import type { RawState } from "@/lib/derive";
import TaskbookApp from "@/components/taskbook/TaskbookApp";
import { StoreProvider, type ServerCalendarData } from "@/components/taskbook/store";

export default async function Home() {
  // One I/O operation for the whole page. This used to be thirteen parallel Prisma calls plus a
  // live fetch of the ICS calendar feeds; at ~490ms per round trip against the hosted database
  // that cost ~3 seconds before anything could render. The calendar is gone from here entirely —
  // the client store fetches it after mount (see StoreProvider).
  let snapshot: Awaited<ReturnType<typeof getPageSnapshot>>;
  try {
    snapshot = await getPageSnapshot();
  } catch (err) {
    console.error("[page] failed to load the page snapshot:", err);
    return (
      <div className="flex flex-1 items-center justify-center bg-(--surface)">
        <p className="font-serif text-(--ink-muted)">Could not reach the database. Check DATABASE_URL in .env.local.</p>
      </div>
    );
  }

  const now = new Date();
  const nowMs = now.getTime();

  // The calendar view (month grid, day details, "Coming up") is computed client-side by
  // TaskbookApp via deriveCalendarView — including for this initial render, since it's a client
  // component rendered on the server too — so it can react instantly to optimistic edits, month
  // navigation, and timezone changes rather than needing a page refresh (see lib/derive.ts).
  const raw: RawState = {
    tasks: snapshot.tasks,
    projects: snapshot.projects,
    habits: snapshot.habits,
    habitCompletions: snapshot.habitCompletions,
    routines: snapshot.routines,
    categories: snapshot.categories,
    captures: snapshot.captures,
    timeZone: snapshot.timeZone,
    dismissedEventIds: snapshot.dismissedEventIds,
    dayPlanBlocks: snapshot.dayPlanBlocks,
    suggestions: snapshot.suggestions,
    aiNotes: snapshot.aiNotes,
    countdowns: snapshot.countdowns,
  };

  const serverData: ServerCalendarData = {
    todayLabel: formatLongDate(now),
    // Notification heartbeat — the UI warns when the cron scheduler has stopped calling in.
    lastCronAtMs: snapshot.lastCronAt ? snapshot.lastCronAt.getTime() : null,
  };

  return (
    <StoreProvider initialRaw={raw} serverData={serverData} nowMs={nowMs}>
      <TaskbookApp />
    </StoreProvider>
  );
}
