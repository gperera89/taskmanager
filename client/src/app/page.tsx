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
  let tasks: Awaited<ReturnType<typeof getTasks>> | undefined;
  let projects: Awaited<ReturnType<typeof getProjects>> | undefined;
  let habits: Awaited<ReturnType<typeof getHabits>> | undefined;
  let routines: Awaited<ReturnType<typeof getRoutines>> | undefined;
  let categories: Awaited<ReturnType<typeof getCategories>> | undefined;
  let apiError: string | null = null;

  try {
    [tasks, projects, habits, routines, categories] = await Promise.all([
      getTasks(),
      getProjects(),
      getHabits(),
      getRoutines(),
      getCategories(),
    ]);
  } catch (err) {
    console.error("[page] failed to load tasks/projects/habits/routines/categories:", err);
    apiError = "Could not reach the database. Check DATABASE_URL in .env.local.";
  }

  if (apiError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#efe9dc]">
        <p className="font-serif text-[#8a8069]">{apiError}</p>
      </div>
    );
  }

  let calendarEvents: Awaited<ReturnType<typeof getCalendarEvents>>["events"] = [];
  let calendarErrors: string[] = [];
  try {
    ({ events: calendarEvents, errors: calendarErrors } = await getCalendarEvents());
  } catch (err) {
    console.error("[page] failed to load calendar events:", err);
    calendarErrors = ["Could not load the calendar."];
  }

  let captures: Awaited<ReturnType<typeof getUnreadVoiceCaptures>> = [];
  try {
    captures = await getUnreadVoiceCaptures();
  } catch (err) {
    console.error("[page] failed to load pending voice captures:", err);
  }

  let timeZone = "Asia/Shanghai";
  let dismissedEventIds: string[] = [];
  try {
    [{ timeZone }, dismissedEventIds] = await Promise.all([getAppSettings(), getDismissedCalendarEventIds()]);
  } catch (err) {
    console.error("[page] failed to load app settings/dismissed events:", err);
  }

  const now = new Date();
  const nowMs = now.getTime();

  // The calendar view (month grid, day details, "Coming up") is computed client-side by
  // TaskbookApp via deriveCalendarView — including for this initial render, since it's a client
  // component rendered on the server too — so it can react instantly to optimistic edits, month
  // navigation, and timezone changes rather than needing a page refresh (see lib/derive.ts).
  const raw: RawState = {
    tasks: tasks!,
    projects: projects!,
    habits: habits!,
    routines: routines!,
    categories: categories!,
    captures,
    timeZone,
    dismissedEventIds,
  };

  const serverData: ServerCalendarData = {
    todayLabel: formatLongDate(now),
    calendarErrors,
  };

  return (
    <StoreProvider initialRaw={raw} serverData={serverData} calendarEvents={calendarEvents} nowMs={nowMs}>
      <TaskbookApp />
    </StoreProvider>
  );
}
