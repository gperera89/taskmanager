import {
  getCategories,
  getDueItems,
  getHabits,
  getProjects,
  getRoutines,
  getTasks,
  getUnreadVoiceCaptures,
} from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import {
  buildMonthCells,
  calendarDateFromDue,
  daysUntil,
  formatLongDate,
  formatShortDate,
  localDaysUntil,
  pad2,
} from "@/lib/taskbookDates";
import type { RawState } from "@/lib/derive";
import TaskbookApp from "@/components/taskbook/TaskbookApp";
import { StoreProvider, type ServerCalendarData } from "@/components/taskbook/store";
import type { DayDetailVM, UpcomingItemVM } from "@/components/taskbook/types";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function relativeLabel(diff: number, displayDate: Date): string {
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${WEEKDAY_NAMES[displayDate.getDay()]} ${displayDate.getDate()}`;
}

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

  const now = new Date();
  const nowMs = now.getTime();
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayDay = now.getDate();

  // --- Calendar rail (month grid, day details, upcoming) — computed server-side and refreshed
  // on focus; not part of the optimistic fast-interaction path. ---
  const monthStart = new Date(Date.UTC(year, month0, 1));
  const monthEnd = new Date(Date.UTC(year, month0 + 1, 0, 23, 59, 59, 999));
  let dueTasks: Awaited<ReturnType<typeof getDueItems>>["tasks"] = [];
  let dueProjects: Awaited<ReturnType<typeof getDueItems>>["projects"] = [];
  try {
    ({ tasks: dueTasks, projects: dueProjects } = await getDueItems(monthStart, monthEnd));
  } catch (err) {
    console.error("[page] failed to load due tasks/projects for the month:", err);
  }

  const monthPrefix = `${year}-${pad2(month0 + 1)}`;
  const dayDetails: Record<number, DayDetailVM> = {};
  const dotDays = new Set<number>();

  function ensureDay(day: number): DayDetailVM {
    if (!dayDetails[day]) {
      const d = new Date(year, month0, day);
      dayDetails[day] = {
        day,
        weekday: WEEKDAY_NAMES[d.getDay()],
        dateLabel: formatShortDate(d),
        tasks: [],
        projects: [],
        events: [],
      };
    }
    return dayDetails[day];
  }

  for (const t of dueTasks) {
    if (!t.dueDate) continue;
    const key = t.dueDate.toISOString().slice(0, 10);
    if (!key.startsWith(monthPrefix)) continue;
    const day = Number(key.slice(8, 10));
    ensureDay(day).tasks.push({ id: t.id, title: t.title, isCompleted: t.isCompleted, projectName: t.project?.name ?? null });
    dotDays.add(day);
  }
  for (const p of dueProjects) {
    if (!p.dueDate) continue;
    const key = p.dueDate.toISOString().slice(0, 10);
    if (!key.startsWith(monthPrefix)) continue;
    const day = Number(key.slice(8, 10));
    ensureDay(day).projects.push({ id: p.id, name: p.name });
    dotDays.add(day);
  }
  for (const e of calendarEvents) {
    const start = new Date(e.start);
    if (start.getFullYear() !== year || start.getMonth() !== month0) continue;
    const day = start.getDate();
    const metaLabel = `${e.allDay ? "All day" : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${e.source}`;
    ensureDay(day).events.push({ id: e.id, title: e.title, metaLabel });
    dotDays.add(day);
  }

  const monthCells = buildMonthCells(year, month0, todayDay, dotDays);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long" }).format(now);

  // Upcoming panel: the next few due tasks/projects/events, regardless of month.
  type UpcomingSource = { sortKey: number; item: UpcomingItemVM };
  const upcomingSources: UpcomingSource[] = [];
  for (const t of tasks!) {
    if (t.isCompleted || !t.dueDate) continue;
    const diff = daysUntil(t.dueDate, now);
    if (diff < 0) continue;
    const d = calendarDateFromDue(t.dueDate);
    upcomingSources.push({
      sortKey: d.getTime(),
      item: { key: `t-${t.id}`, a: relativeLabel(diff, d), b: t.title, c: t.category, hasC: true },
    });
  }
  for (const p of projects!) {
    if (p.isCompleted || !p.dueDate) continue;
    const diff = daysUntil(p.dueDate, now);
    if (diff < 0) continue;
    const d = calendarDateFromDue(p.dueDate);
    upcomingSources.push({
      sortKey: d.getTime(),
      item: { key: `p-${p.id}`, a: relativeLabel(diff, d), b: p.name, c: "Project", hasC: true },
    });
  }
  for (const e of calendarEvents) {
    const start = new Date(e.start);
    const diff = localDaysUntil(start, now);
    if (start.getTime() < now.getTime() && diff !== 0) continue;
    upcomingSources.push({
      sortKey: start.getTime(),
      item: {
        key: `e-${e.id}`,
        a: relativeLabel(diff, start),
        b: e.title,
        c: `${e.allDay ? "All day" : start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${e.source}`,
        hasC: true,
      },
    });
  }
  upcomingSources.sort((a, b) => a.sortKey - b.sortKey);
  const upcoming = upcomingSources.slice(0, 3).map((s) => s.item);

  const raw: RawState = {
    tasks: tasks!,
    projects: projects!,
    habits: habits!,
    routines: routines!,
    categories: categories!,
    captures,
  };

  const serverData: ServerCalendarData = {
    todayLabel: formatLongDate(now),
    monthLabel,
    year,
    monthCells,
    dayDetails,
    upcoming,
    calendarErrors,
  };

  return (
    <StoreProvider initialRaw={raw} serverData={serverData} nowMs={nowMs}>
      <TaskbookApp />
    </StoreProvider>
  );
}
