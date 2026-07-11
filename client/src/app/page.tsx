import {
  getAppSettings,
  getCategories,
  getDismissedCalendarEventIds,
  getHabits,
  getProjects,
  getRoutines,
  getTasks,
  getUnreadVoiceCaptures,
} from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import { formatLongDate } from "@/lib/taskbookDates";
import type { RawState } from "@/lib/derive";
import TaskbookApp from "@/components/taskbook/TaskbookApp";
import { StoreProvider, type ServerCalendarData } from "@/components/taskbook/store";

export default async function Home() {
  // Every fetch below is independent, so kick them all off at once and await each with its own
  // fallback — the calendar (ICS parse of ~1000 events), voice captures, settings, and dismissed
  // events no longer sit behind the entity queries in a serial waterfall. Each non-critical fetch
  // resolves to a safe default on failure so a single failing section can't take down the page.
  const entitiesPromise = Promise.all([getTasks(), getProjects(), getHabits(), getRoutines(), getCategories()]);
  const calendarPromise = getCalendarEvents().catch((err) => {
    console.error("[page] failed to load calendar events:", err);
    return { events: [] as Awaited<ReturnType<typeof getCalendarEvents>>["events"], errors: ["Could not load the calendar."] };
  });
  const capturesPromise = getUnreadVoiceCaptures().catch((err) => {
    console.error("[page] failed to load pending voice captures:", err);
    return [] as Awaited<ReturnType<typeof getUnreadVoiceCaptures>>;
  });
  const settingsPromise = getAppSettings().catch((err) => {
    console.error("[page] failed to load app settings:", err);
    return { timeZone: "Asia/Shanghai", lastCronAt: null as Date | null };
  });
  const dismissedPromise = getDismissedCalendarEventIds().catch((err) => {
    console.error("[page] failed to load dismissed events:", err);
    return [] as string[];
  });

  let tasks: Awaited<ReturnType<typeof getTasks>>;
  let projects: Awaited<ReturnType<typeof getProjects>>;
  let habits: Awaited<ReturnType<typeof getHabits>>;
  let routines: Awaited<ReturnType<typeof getRoutines>>;
  let categories: Awaited<ReturnType<typeof getCategories>>;
  try {
    [tasks, projects, habits, routines, categories] = await entitiesPromise;
  } catch (err) {
    console.error("[page] failed to load tasks/projects/habits/routines/categories:", err);
    // Settle the other in-flight promises so their rejections (if any) don't go unhandled.
    await Promise.allSettled([calendarPromise, capturesPromise, settingsPromise, dismissedPromise]);
    return (
      <div className="flex flex-1 items-center justify-center bg-(--surface)">
        <p className="font-serif text-(--ink-muted)">Could not reach the database. Check DATABASE_URL in .env.local.</p>
      </div>
    );
  }

  const { events: calendarEvents, errors: calendarErrors } = await calendarPromise;
  const captures = await capturesPromise;
  const { timeZone, lastCronAt } = await settingsPromise;
  const dismissedEventIds = await dismissedPromise;

  const now = new Date();
  const nowMs = now.getTime();

  // The calendar view (month grid, day details, "Coming up") is computed client-side by
  // TaskbookApp via deriveCalendarView — including for this initial render, since it's a client
  // component rendered on the server too — so it can react instantly to optimistic edits, month
  // navigation, and timezone changes rather than needing a page refresh (see lib/derive.ts).
  const raw: RawState = {
    tasks,
    projects,
    habits,
    routines,
    categories,
    captures,
    timeZone,
    dismissedEventIds,
  };

  const serverData: ServerCalendarData = {
    todayLabel: formatLongDate(now),
    calendarErrors,
    // Notification heartbeat — the UI warns when the cron scheduler has stopped calling in.
    lastCronAtMs: lastCronAt ? lastCronAt.getTime() : null,
  };

  return (
    <StoreProvider initialRaw={raw} serverData={serverData} calendarEvents={calendarEvents} nowMs={nowMs}>
      <TaskbookApp />
    </StoreProvider>
  );
}
