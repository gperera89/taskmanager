import {
  getCategories,
  getDueItems,
  getHabitsWithStatus,
  getProjects,
  getRoutines,
  getTasks,
  getUnreadVoiceCaptures,
  isRoutineTickedNow,
  type Routine,
} from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import {
  buildMonthCells,
  calendarDateFromDue,
  daysUntil,
  bucketForDue,
  formatDueLabel,
  formatLongDate,
  formatShortDate,
  localDaysUntil,
  pad2,
  type DueBucket,
} from "@/lib/taskbookDates";
import { describeTaskRepeat } from "@/lib/taskRecurrence";
import TaskbookApp from "@/components/taskbook/TaskbookApp";
import type {
  DayDetailVM,
  HabitCardVM,
  ProjectCardVM,
  RoutineItemVM,
  TaskbookData,
  TaskGroupVM,
  TaskItemVM,
  UpcomingItemVM,
  VoiceCaptureVM,
} from "@/components/taskbook/types";

const HABIT_UNIT_WORD: Record<string, string> = { DAY: "day", WEEK: "week", MONTH: "month" };
function habitIntervalLabel(value: number, unit: string): string {
  const word = HABIT_UNIT_WORD[unit] ?? unit.toLowerCase();
  return value === 1 ? `Every ${word}` : `Every ${value} ${word}s`;
}
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_ABBR = WEEKDAY_NAMES;

function toDateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

// "" when the due date has no time set (i.e. it's UTC midnight — see api.ts's combineDueDateTime).
function toTimeInputValue(date: Date | null): string {
  if (!date || (date.getUTCHours() === 0 && date.getUTCMinutes() === 0)) return "";
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const ORDINAL_WORDS: Record<number, string> = { 1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", [-1]: "Last" };
const WEEKDAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function intervalWord(n: number, unit: string): string {
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

function relativeDaysAgoLabel(d: Date, now: Date): string {
  const diff = -localDaysUntil(d, now);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `${diff} days ago`;
}

function relativeLabel(diff: number, displayDate: Date): string {
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${WEEKDAY_NAMES[displayDate.getDay()]} ${displayDate.getDate()}`;
}

export default async function Home() {
  let tasks: Awaited<ReturnType<typeof getTasks>> | undefined;
  let projects: Awaited<ReturnType<typeof getProjects>> | undefined;
  let habitStatuses: Awaited<ReturnType<typeof getHabitsWithStatus>> | undefined;
  let routines: Awaited<ReturnType<typeof getRoutines>> | undefined;
  let categories: Awaited<ReturnType<typeof getCategories>> | undefined;
  let apiError: string | null = null;

  try {
    [tasks, projects, habitStatuses, routines, categories] = await Promise.all([
      getTasks(),
      getProjects(),
      getHabitsWithStatus(),
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

  let pendingCaptures: Awaited<ReturnType<typeof getUnreadVoiceCaptures>> = [];
  try {
    pendingCaptures = await getUnreadVoiceCaptures();
  } catch (err) {
    console.error("[page] failed to load pending voice captures:", err);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayDay = now.getDate();

  const monthStart = new Date(Date.UTC(year, month0, 1));
  const monthEnd = new Date(Date.UTC(year, month0 + 1, 0, 23, 59, 59, 999));
  let dueTasks: Awaited<ReturnType<typeof getDueItems>>["tasks"] = [];
  let dueProjects: Awaited<ReturnType<typeof getDueItems>>["projects"] = [];
  try {
    ({ tasks: dueTasks, projects: dueProjects } = await getDueItems(monthStart, monthEnd));
  } catch (err) {
    console.error("[page] failed to load due tasks/projects for the month:", err);
    // Calendar rail just won't show dots/details for the month; not fatal.
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

  // Upcoming panel (default rail state): the next few due tasks/projects/events, regardless
  // of which month they fall in.
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

  // --- Tasks tab: grouped by due date ---
  type TaskWithSubtasks = Awaited<ReturnType<typeof getTasks>>[number];
  const projectNameById = new Map(projects!.map((p) => [p.id, p.name]));
  function toTaskVM(t: TaskWithSubtasks): TaskItemVM {
    const dueLabel = t.dueDate ? formatDueLabel(t.dueDate) : null;
    const repeatLabel = t.repeatFrequency
      ? describeTaskRepeat({
          frequency: t.repeatFrequency,
          interval: t.repeatInterval ?? 1,
          daysOfWeek: t.repeatDaysOfWeek,
          monthlyMode: t.repeatMonthlyMode ?? "DATE",
          dayOfMonth: t.repeatDayOfMonth,
          monthlyOrdinal: t.repeatMonthlyOrdinal,
          monthlyWeekday: t.repeatMonthlyWeekday,
        })
      : null;
    return {
      id: t.id,
      title: t.title,
      isCompleted: t.isCompleted,
      category: t.category,
      description: t.description,
      dueDateValue: toDateInputValue(t.dueDate),
      dueTimeValue: toTimeInputValue(t.dueDate),
      dueLabel,
      projectId: t.projectId,
      projectName: t.projectId ? projectNameById.get(t.projectId) ?? null : null,
      subtasksDone: t.subtasks.filter((s) => s.isCompleted).length,
      subtasksTotal: t.subtasks.length,
      repeatFrequency: t.repeatFrequency,
      repeatInterval: t.repeatInterval ?? 1,
      repeatDaysOfWeek: t.repeatDaysOfWeek,
      repeatMonthlyMode: t.repeatMonthlyMode ?? "DATE",
      repeatDayOfMonth: t.repeatDayOfMonth,
      repeatMonthlyOrdinal: t.repeatMonthlyOrdinal,
      repeatMonthlyWeekday: t.repeatMonthlyWeekday,
      repeatLabel,
    };
  }

  const bucketOrder: DueBucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];
  const bucketLabel = (b: DueBucket): string => {
    switch (b) {
      case "overdue":
        return "Overdue";
      case "today":
        return `Today · ${formatShortDate(now)}`;
      case "tomorrow":
        return `Tomorrow · ${formatShortDate(new Date(year, month0, todayDay + 1))}`;
      case "week":
        return "This week";
      case "later":
        return "Later";
      case "none":
        return "No date";
    }
  };

  const grouped = new Map<DueBucket, TaskItemVM[]>();
  for (const t of tasks!) {
    const vm = toTaskVM(t);
    const b = bucketForDue(t.dueDate, now);
    if (!grouped.has(b)) grouped.set(b, []);
    grouped.get(b)!.push(vm);
  }
  const taskGroups: TaskGroupVM[] = bucketOrder
    .filter((b) => grouped.has(b))
    .map((b) => ({ key: b, label: bucketLabel(b), tasks: grouped.get(b)! }));
  const tasksRemainingToday = (grouped.get("today") ?? []).filter((t) => !t.isCompleted).length;

  // --- Projects tab ---
  const tasksByProject = new Map<string, TaskWithSubtasks[]>();
  for (const t of tasks!) {
    if (!t.projectId) continue;
    if (!tasksByProject.has(t.projectId)) tasksByProject.set(t.projectId, []);
    tasksByProject.get(t.projectId)!.push(t);
  }
  const projectCards: ProjectCardVM[] = projects!.map((p) => {
    const items = tasksByProject.get(p.id) ?? [];
    const done = items.filter((t) => t.isCompleted).length;
    const total = items.length;
    const progressPct = total ? Math.round((done / total) * 100) : 0;
    const previewSource = [...items].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
    const preview = previewSource.slice(0, 3).map((t) => ({
      id: t.id,
      title: t.title,
      isCompleted: t.isCompleted,
      dueLabel: t.dueDate ? formatShortDate(calendarDateFromDue(t.dueDate)) : null,
    }));
    const moreCount = Math.max(0, total - preview.length);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      dueDateValue: toDateInputValue(p.dueDate),
      dueLabel: p.dueDate ? formatShortDate(calendarDateFromDue(p.dueDate)) : null,
      done,
      total,
      progressPct,
      preview,
      moreCount,
    };
  });
  const activeProjectCount = projects!.filter((p) => !p.isCompleted).length;

  // --- Routines tab ---
  function scheduleLabel(r: Routine): string {
    if (r.frequency === "DAILY") {
      return r.interval === 1 ? "" : intervalWord(r.interval, "day");
    }
    if (r.frequency === "WEEKLY") {
      const weekPart = intervalWord(r.interval, "week");
      const days = r.daysOfWeek.length
        ? [...r.daysOfWeek].sort((a, b) => a - b).map((d) => DOW_ABBR[d]).join(", ")
        : "";
      return days ? `${weekPart} · ${days}` : weekPart;
    }
    const monthPart = intervalWord(r.interval, "month");
    if (r.monthlyMode === "WEEKDAY" && r.monthlyOrdinal != null && r.monthlyWeekday != null) {
      return `${monthPart} · ${ORDINAL_WORDS[r.monthlyOrdinal] ?? r.monthlyOrdinal} ${WEEKDAY_FULL_NAMES[r.monthlyWeekday]}`;
    }
    if (r.dayOfMonth === -1) return `${monthPart} · Last day`;
    return r.dayOfMonth ? `${monthPart} · ${ordinal(r.dayOfMonth)}` : monthPart;
  }
  const routineVMs: RoutineItemVM[] = routines!.map((r) => ({
    id: r.id,
    title: r.title,
    reminderTime: r.reminderTime,
    frequency: r.frequency,
    interval: r.interval,
    daysOfWeek: r.daysOfWeek,
    monthlyMode: r.monthlyMode,
    dayOfMonth: r.dayOfMonth,
    monthlyOrdinal: r.monthlyOrdinal,
    monthlyWeekday: r.monthlyWeekday,
    isActive: r.isActive,
    isTicked: isRoutineTickedNow(r),
    scheduleLabel: scheduleLabel(r),
    subroutines: r.subroutines.map((s) => ({ id: s.id, title: s.title })),
  }));
  const routineDaily = routineVMs.filter((r) => r.frequency === "DAILY" && r.interval === 1);
  const routineScheduled = routineVMs.filter((r) => r.frequency !== "DAILY" || r.interval !== 1);
  const routineTotalCount = routineVMs.length;

  // --- Habits tab ---
  type HabitStatusItem = Awaited<ReturnType<typeof getHabitsWithStatus>>[number];
  function habitDetailLabel(hs: HabitStatusItem): string {
    const freqLabel = habitIntervalLabel(hs.habit.intervalValue, hs.habit.intervalUnit);
    if (hs.atRisk) {
      const lastDoneLabel = hs.habit.lastCompletedDate ? relativeDaysAgoLabel(hs.habit.lastCompletedDate, now) : "not yet done";
      return `Last done ${lastDoneLabel} · do it today to keep your ${hs.habit.currentStreak}-day streak.`;
    }
    if (hs.isDoneThisPeriod) {
      return `${freqLabel} · done today`;
    }
    const daysLabel = hs.daysRemaining <= 1 ? "due tomorrow" : `due in ${Math.ceil(hs.daysRemaining)} days`;
    return `${freqLabel} · ${daysLabel}`;
  }
  const habitVMs: HabitCardVM[] = habitStatuses!.map((hs) => ({
    id: hs.habit.id,
    title: hs.habit.title,
    intervalValue: hs.habit.intervalValue,
    intervalUnit: hs.habit.intervalUnit,
    currentStreak: hs.habit.currentStreak,
    longestStreak: hs.habit.longestStreak,
    atRisk: hs.atRisk,
    isDoneThisPeriod: hs.isDoneThisPeriod,
    detailLabel: habitDetailLabel(hs),
  }));
  const habitFeatured = habitVMs[0] ?? null;
  const rest = habitVMs.slice(1);
  const habitSuggested = rest.filter((h) => !h.isDoneThisPeriod);
  const habitOnTrack = rest.filter((h) => h.isDoneThisPeriod);
  const habitAtRiskCount = habitVMs.filter((h) => h.atRisk).length;

  // --- Pending voice captures (notification panel) ---
  const CAPTURED_KIND_MAP: Record<string, VoiceCaptureVM["kind"]> = {
    TASK: "task",
    PROJECT: "project",
    ROUTINE: "routine",
    HABIT: "habit",
  };
  const pendingCaptureVMs: VoiceCaptureVM[] = pendingCaptures.map((c) => ({
    id: c.id,
    transcript: c.transcript,
    kind: CAPTURED_KIND_MAP[c.kind],
    entityId: c.entityId,
    summary: c.summary,
    parseError: c.parseError,
  }));

  const data: TaskbookData = {
    todayLabel: formatLongDate(now),
    monthLabel,
    year,
    monthCells,
    dayDetails,
    upcoming,
    taskGroups,
    tasksRemainingToday,
    projectCards,
    activeProjectCount,
    routineDaily,
    routineScheduled,
    routineTotalCount,
    habitFeatured,
    habitSuggested,
    habitOnTrack,
    habitAtRiskCount,
    calendarErrors,
    projectOptions: projects!.map((p) => ({ id: p.id, name: p.name })),
    categoryOptions: categories!.map((c) => ({ id: c.id, name: c.name })),
    pendingCaptures: pendingCaptureVMs,
  };

  return <TaskbookApp data={data} />;
}
