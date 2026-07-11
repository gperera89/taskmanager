// Client-safe (NO "server-only") pure derivation of the Taskbook view-models from raw entity
// rows. This is the single source of truth for how tasks/projects/habits/routines/categories/
// captures/calendar become the grouped, bucketed, ranked VMs the UI renders — run on the server
// for the initial page load AND on the client after every optimistic mutation or month-nav
// click, so a local edit re-buckets/re-counts/re-derives exactly the way a server round trip
// would have (this used to exclude the calendar rail; see git history if that distinction ever
// needs resurrecting).

import type { Task, Project, Habit, Routine, Category, VoiceCapture } from "@prisma/client";
import { habitPeriodStatus, taskOrderCompare, MS_PER_DAY, ROUTINE_TICK_EXPIRY_MS } from "@/lib/shared";
export { combineDueDateTime, ROUTINE_TICK_EXPIRY_MS } from "@/lib/shared";
import {
  bucketForDue,
  buildMonthCells,
  calendarDateFromDue,
  daysUntil,
  formatDueLabel,
  formatEventTime,
  formatFullDate,
  formatShortDate,
  localDaysUntil,
  pad2,
  zonedCalendarDate,
  zonedDaysUntil,
  zonedNow,
  zonedYMD,
  type DueBucket,
  type MonthCell,
} from "@/lib/taskbookDates";
import { describeTaskRepeat, nextRoutineOccurrence, type TaskRepeatRule } from "@/lib/taskRecurrence";
import type {
  CalendarEvent,
  CategoryOption,
  DayDetailVM,
  HabitCardVM,
  Mode,
  ProjectCardVM,
  ProjectOption,
  RoutineItemVM,
  TaskGroupVM,
  TaskItemVM,
  UpcomingItemVM,
  VoiceCaptureVM,
} from "@/components/taskbook/types";

// --- Raw state shape (serializable straight from Prisma, incl. Date fields) ---

export type RawTask = Task & { subtasks: Task[] };
export type RawRoutine = Routine & { subroutines: Routine[] };

export type RawState = {
  tasks: RawTask[]; // top-level tasks only, each with its subtasks nested (mirrors getTasks)
  projects: Project[];
  habits: Habit[];
  routines: RawRoutine[]; // top-level routines only, each with its subroutines nested
  categories: Category[];
  captures: VoiceCapture[];
  timeZone: string; // AppSettings.timeZone — governs due/reminder math and calendar display
  dismissedEventIds: string[]; // DismissedCalendarEvent ids, filtered out of the calendar view
};

// The entity slice of TaskbookData — everything except the calendar view (see
// deriveCalendarView below, which needs extra params — calendarEvents, the viewed month — that
// don't fit this signature).
export type DerivedEntities = {
  taskGroups: TaskGroupVM[];
  tasksRemainingToday: number;
  projectCards: ProjectCardVM[];
  activeProjectCount: number;
  routineList: RoutineItemVM[];
  routineTotalCount: number;
  habitSuggested: HabitCardVM[];
  habitOnTrack: HabitCardVM[];
  habitAtRiskCount: number;
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  pendingCaptures: VoiceCaptureVM[];
};

// Mode filtering: each Category row carries a scope (WORK/HOME/NONE). A task shows in a
// non-"all" mode when its category's scope matches, or when the scope is NONE (visible in
// both — the old behavior of hiding anything that wasn't literally named "Work"/"Home" made
// tasks silently vanish). The literal-name fallback keeps things sane before the scope
// backfill has run. Calendar events are matched by their ICS source label instead, since they
// have no category — "Outlook" is the work calendar, "Gmail" the home one (see lib/calendar.ts).
function taskMatchesMode(category: string, mode: Mode, scopeByName: Map<string, Mode | "both">): boolean {
  if (mode === "all") return true;
  const scope = scopeByName.get(category.toLowerCase());
  if (scope !== undefined) return scope === "both" || scope === mode;
  return category.toLowerCase() === mode;
}

function categoryScopeMap(categories: Category[]): Map<string, Mode | "both"> {
  return new Map(
    categories.map((c) => [c.name.toLowerCase(), c.scope === "WORK" ? "work" : c.scope === "HOME" ? "home" : "both"])
  );
}

function eventMatchesMode(source: string, mode: Mode): boolean {
  if (mode === "all") return true;
  return mode === "work" ? source === "Outlook" : source === "Gmail";
}

export function isRoutineTickedNow(routine: Pick<Routine, "lastCompletedAt">, nowMs: number): boolean {
  if (!routine.lastCompletedAt) return false;
  return nowMs - new Date(routine.lastCompletedAt).getTime() < ROUTINE_TICK_EXPIRY_MS;
}

// --- Formatting helpers (ported from page.tsx) ---

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_ABBR = WEEKDAY_NAMES;
const HABIT_UNIT_WORD: Record<string, string> = { DAY: "day", WEEK: "week", MONTH: "month" };
const ORDINAL_WORDS: Record<number, string> = { 1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", [-1]: "Last" };
const WEEKDAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function habitIntervalLabel(value: number, unit: string): string {
  const word = HABIT_UNIT_WORD[unit] ?? unit.toLowerCase();
  return value === 1 ? `Every ${word}` : `Every ${value} ${word}s`;
}

function intervalWord(n: number, unit: string): string {
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function toDateInputValue(date: Date | null): string {
  return date ? new Date(date).toISOString().slice(0, 10) : "";
}

function toTimeInputValue(date: Date | null): string {
  if (!date) return "";
  const d = new Date(date);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return "";
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function relativeDaysAgoLabel(d: Date, now: Date): string {
  const diff = -localDaysUntil(new Date(d), now);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `${diff} days ago`;
}

// --- Task VMs ---

function toTaskVM(t: RawTask, projectNameById: Map<string, string>): TaskItemVM {
  const due = t.dueDate ? new Date(t.dueDate) : null;
  const dueLabel = due ? formatDueLabel(due) : null;
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
    dueDateValue: toDateInputValue(due),
    dueTimeValue: toTimeInputValue(due),
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
    section: t.section,
    sortOrder: t.sortOrder,
    reminderLeadMinutes: t.reminderLeadMinutes,
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, isCompleted: s.isCompleted })),
  };
}

const BUCKET_ORDER: DueBucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

function bucketLabel(b: DueBucket, now: Date, year: number, month0: number, todayDay: number): string {
  switch (b) {
    case "overdue":
      return "Overdue";
    case "today":
      return `Today · ${formatFullDate(now)}`;
    case "tomorrow":
      return `Tomorrow · ${formatFullDate(new Date(year, month0, todayDay + 1))}`;
    case "week":
      return "This week";
    case "later":
      return "Later";
    case "none":
      return "No date";
  }
}

// --- Routine VMs ---

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

// --- The main derivation ---

export function deriveEntities(raw: RawState, nowMs: number, mode: Mode): DerivedEntities {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayDay = now.getDate();

  // Tasks — grouped by due bucket. Projects/routines/habits aren't categorized work/home,
  // so the mode filter only narrows the task list (and, below, the calendar).
  const scopeByName = categoryScopeMap(raw.categories);
  const projectNameById = new Map(raw.projects.map((p) => [p.id, p.name]));
  const grouped = new Map<DueBucket, { vm: TaskItemVM; dueMs: number | null; createdMs: number }[]>();
  for (const t of raw.tasks) {
    if (!taskMatchesMode(t.category, mode, scopeByName)) continue;
    const vm = toTaskVM(t, projectNameById);
    const b = bucketForDue(t.dueDate ? new Date(t.dueDate) : null, now);
    if (!grouped.has(b)) grouped.set(b, []);
    grouped.get(b)!.push({ vm, dueMs: t.dueDate ? new Date(t.dueDate).getTime() : null, createdMs: new Date(t.createdAt).getTime() });
  }
  // Within each bucket: manual order first (drag-and-drop), then due time, then creation.
  for (const entries of grouped.values()) {
    entries.sort((a, b) =>
      taskOrderCompare(
        { sortOrder: a.vm.sortOrder, dueMs: a.dueMs, createdMs: a.createdMs },
        { sortOrder: b.vm.sortOrder, dueMs: b.dueMs, createdMs: b.createdMs }
      )
    );
  }
  const taskGroups: TaskGroupVM[] = BUCKET_ORDER.filter((b) => grouped.has(b)).map((b) => ({
    key: b,
    label: bucketLabel(b, now, year, month0, todayDay),
    tasks: grouped.get(b)!.map((e) => e.vm),
  }));
  const tasksRemainingToday = (grouped.get("today") ?? []).filter((e) => !e.vm.isCompleted).length;

  // Projects.
  const tasksByProject = new Map<string, RawTask[]>();
  for (const t of raw.tasks) {
    if (!t.projectId) continue;
    if (!tasksByProject.has(t.projectId)) tasksByProject.set(t.projectId, []);
    tasksByProject.get(t.projectId)!.push(t);
  }
  const visibleProjects = raw.projects.filter((p) => {
    if (mode === "all") return true;
    return (tasksByProject.get(p.id) ?? []).some((t) => taskMatchesMode(t.category, mode, scopeByName));
  });
  const projectCards: ProjectCardVM[] = visibleProjects.map((p) => {
    const items = (tasksByProject.get(p.id) ?? []).filter((t) => taskMatchesMode(t.category, mode, scopeByName));
    const done = items.filter((t) => t.isCompleted).length;
    const total = items.length;
    const progressPct = total ? Math.round((done / total) * 100) : 0;
    const orderKey = (t: RawTask) => ({
      sortOrder: t.sortOrder,
      dueMs: t.dueDate ? new Date(t.dueDate).getTime() : null,
      createdMs: new Date(t.createdAt).getTime(),
    });
    const sorted = [...items].sort(
      (a, b) => Number(a.isCompleted) - Number(b.isCompleted) || taskOrderCompare(orderKey(a), orderKey(b))
    );
    const tasks = sorted.map((t) => toTaskVM(t, projectNameById));
    // Group by section, preserving first-appearance order; unsectioned tasks lead.
    const sectionOrder: (string | null)[] = [null];
    const bySection = new Map<string | null, TaskItemVM[]>([[null, []]]);
    for (const t of tasks) {
      const key = t.section;
      if (!bySection.has(key)) {
        bySection.set(key, []);
        sectionOrder.push(key);
      }
      bySection.get(key)!.push(t);
    }
    const sections = sectionOrder
      .map((name) => ({ name, tasks: bySection.get(name)! }))
      .filter((s) => s.name === null || s.tasks.length > 0);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      dueDateValue: toDateInputValue(p.dueDate),
      dueLabel: p.dueDate ? formatShortDate(calendarDateFromDue(new Date(p.dueDate))) : null,
      reminderLeadMinutes: p.reminderLeadMinutes,
      done,
      total,
      progressPct,
      tasks,
      sections,
      sectionNames: sectionOrder.filter((s): s is string => s !== null),
    };
  });
  const activeProjectCount = visibleProjects.filter((p) => !p.isCompleted).length;

  // Routines. "Next notification" always looks strictly past today (see nextRoutineOccurrence's
  // comment) and is computed against the configured timezone's wall-clock "now", matching the
  // notification cron's own convention (notifications.ts's zonedNow, imported here since
  // taskbookDates.ts is client-safe, unlike that server-only file).
  const zonedNowDate = zonedNow(nowMs, raw.timeZone);
  const zonedToday = Date.UTC(zonedNowDate.getUTCFullYear(), zonedNowDate.getUTCMonth(), zonedNowDate.getUTCDate());
  const routineVMs: RoutineItemVM[] = raw.routines.map((r) => {
    const rule: TaskRepeatRule = {
      frequency: r.frequency,
      interval: r.interval,
      daysOfWeek: r.daysOfWeek,
      monthlyMode: r.monthlyMode,
      dayOfMonth: r.dayOfMonth,
      monthlyOrdinal: r.monthlyOrdinal,
      monthlyWeekday: r.monthlyWeekday,
    };
    const nextDate = nextRoutineOccurrence(rule, zonedNowDate, r.pausedUntil ? new Date(r.pausedUntil) : null);
    const diffDays = Math.round((nextDate.getTime() - zonedToday) / MS_PER_DAY);
    return {
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
      isTicked: isRoutineTickedNow(r, nowMs),
      scheduleLabel: scheduleLabel(r),
      pausedUntil: toDateInputValue(r.pausedUntil),
      nextNotificationLabel: diffDays === 1 ? "tomorrow" : formatShortDate(calendarDateFromDue(nextDate)),
      nextOccurrenceMs: nextDate.getTime(),
      subroutines: r.subroutines.map((s) => ({ id: s.id, title: s.title })),
    };
  });
  const routineList = [...routineVMs].sort((a, b) => a.nextOccurrenceMs - b.nextOccurrenceMs);
  const routineTotalCount = routineVMs.length;

  // Habits — status computed (period boundaries local-midnight-aligned in the configured
  // zone, see lib/shared.ts), then ranked by urgency (soonest to break its streak first).
  const habitStatuses = raw.habits
    .map((habit) => {
      const status = habitPeriodStatus(habit, now, raw.timeZone);
      return {
        habit,
        daysRemaining: status.daysRemaining,
        isDoneThisPeriod: status.isDoneThisPeriod,
        lapsed: status.lapsed,
        atRisk: status.atRisk,
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  function habitDetailLabel(hs: (typeof habitStatuses)[number]): string {
    const freqLabel = habitIntervalLabel(hs.habit.intervalValue, hs.habit.intervalUnit);
    if (hs.atRisk) {
      const lastDoneLabel = hs.habit.lastCompletedDate
        ? relativeDaysAgoLabel(new Date(hs.habit.lastCompletedDate), now)
        : "not yet done";
      return `Last done ${lastDoneLabel} · do it today to keep your ${hs.habit.currentStreak}-day streak.`;
    }
    if (hs.isDoneThisPeriod) return `${freqLabel} · done today`;
    const daysLabel =
      hs.daysRemaining <= 1 ? "1 day left to complete" : `${Math.ceil(hs.daysRemaining)} days left to complete`;
    return `${freqLabel} · ${daysLabel}`;
  }

  const habitVMs: HabitCardVM[] = habitStatuses.map((hs) => ({
    id: hs.habit.id,
    title: hs.habit.title,
    intervalValue: hs.habit.intervalValue,
    intervalUnit: hs.habit.intervalUnit,
    currentStreak: hs.habit.currentStreak,
    longestStreak: hs.habit.longestStreak,
    atRisk: hs.atRisk,
    lapsed: hs.lapsed,
    isDoneThisPeriod: hs.isDoneThisPeriod,
    detailLabel: habitDetailLabel(hs),
  }));
  const habitSuggested = habitVMs.filter((h) => !h.isDoneThisPeriod);
  const habitOnTrack = habitVMs.filter((h) => h.isDoneThisPeriod);
  const habitAtRiskCount = habitVMs.filter((h) => h.atRisk).length;

  // Voice captures (notification panel).
  const CAPTURED_KIND_MAP: Record<string, VoiceCaptureVM["kind"]> = {
    TASK: "task",
    PROJECT: "project",
    ROUTINE: "routine",
    HABIT: "habit",
  };
  const pendingCaptures: VoiceCaptureVM[] = raw.captures.map((c) => ({
    id: c.id,
    transcript: c.transcript,
    kind: CAPTURED_KIND_MAP[c.kind],
    entityId: c.entityId,
    summary: c.summary,
    parseError: c.parseError,
  }));

  return {
    taskGroups,
    tasksRemainingToday,
    projectCards,
    activeProjectCount,
    routineList,
    routineTotalCount,
    habitSuggested,
    habitOnTrack,
    habitAtRiskCount,
    projectOptions: raw.projects.map((p) => ({ id: p.id, name: p.name })),
    categoryOptions: raw.categories.map((c) => ({ id: c.id, name: c.name, scope: c.scope })),
    pendingCaptures,
  };
}

// --- Calendar view (month grid, day details, "Coming up") ---

export type CalendarViewVM = {
  monthCells: MonthCell[];
  monthLabel: string;
  year: number;
  dayDetails: Record<number, DayDetailVM>;
  upcoming: UpcomingItemVM[];
};

const MONTH_LONG_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long" });

function relativeUpcomingLabel(diff: number, displayDate: Date): string {
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${WEEKDAY_NAMES[displayDate.getDay()]} ${displayDate.getDate()}`;
}

// Builds the calendar view for whichever month is being *viewed* (`viewYear`/`viewMonth0`,
// independent of "now") from the live entity state plus the separately-synced ICS events. Called
// both server-side (page.tsx, current month only) and client-side (TaskbookApp, on every
// optimistic mutation, month-nav click, or timezone change) — completed tasks/projects and
// dismissed events are filtered out here, so they vanish the instant that state changes rather
// than waiting for a focus-triggered refresh.
export function deriveCalendarView(
  raw: RawState,
  calendarEvents: CalendarEvent[],
  nowMs: number,
  viewYear: number,
  viewMonth0: number,
  mode: Mode
): CalendarViewVM {
  const now = new Date(nowMs);
  const today = zonedYMD(now, raw.timeZone);
  const dismissed = new Set(raw.dismissedEventIds);
  const scopeByName = categoryScopeMap(raw.categories);
  const visibleEvents = calendarEvents.filter((e) => eventMatchesMode(e.source, mode));

  const dayDetails: Record<number, DayDetailVM> = {};
  const dotDays = new Set<number>();

  function ensureDay(day: number): DayDetailVM {
    if (!dayDetails[day]) {
      const d = new Date(viewYear, viewMonth0, day);
      dayDetails[day] = {
        day,
        weekday: WEEKDAY_FULL_NAMES[d.getDay()],
        dateLabel: formatShortDate(d),
        fullLabel: formatFullDate(d),
        tasks: [],
        projects: [],
        events: [],
        dismissedEvents: [],
      };
    }
    return dayDetails[day];
  }

  // Every day of the viewed month gets an entry up front, not just ones with something due —
  // otherwise clicking an empty day leaves dayDetails[day] undefined and the day view renders
  // nothing at all (not even its "nothing due" empty state) instead of an actual blank day.
  const daysInMonth = new Date(viewYear, viewMonth0 + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) ensureDay(day);

  const projectNameById = new Map(raw.projects.map((p) => [p.id, p.name]));

  for (const t of raw.tasks) {
    if (t.isCompleted || !t.dueDate || !taskMatchesMode(t.category, mode, scopeByName)) continue;
    const d = calendarDateFromDue(new Date(t.dueDate));
    if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth0) continue;
    ensureDay(d.getDate()).tasks.push({
      id: t.id,
      title: t.title,
      isCompleted: t.isCompleted,
      projectName: t.projectId ? projectNameById.get(t.projectId) ?? null : null,
    });
    dotDays.add(d.getDate());
  }
  for (const p of raw.projects) {
    if (p.isCompleted || !p.dueDate) continue;
    const d = calendarDateFromDue(new Date(p.dueDate));
    if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth0) continue;
    ensureDay(d.getDate()).projects.push({ id: p.id, name: p.name });
    dotDays.add(d.getDate());
  }
  for (const e of visibleEvents) {
    const start = new Date(e.start);
    const zoned = zonedYMD(start, raw.timeZone);
    if (zoned.year !== viewYear || zoned.month0 !== viewMonth0) continue;
    if (dismissed.has(e.id)) {
      ensureDay(zoned.day).dismissedEvents.push({ id: e.id, title: e.title });
      continue;
    }
    const metaLabel = `${e.allDay ? "All day" : formatEventTime(e.start, raw.timeZone)} · ${e.source}`;
    ensureDay(zoned.day).events.push({ id: e.id, title: e.title, metaLabel, allDay: e.allDay, source: e.source });
    dotDays.add(zoned.day);
  }

  const monthCells = buildMonthCells(viewYear, viewMonth0, today, dotDays);
  const monthLabel = MONTH_LONG_FORMAT.format(new Date(viewYear, viewMonth0, 1));

  // "Coming up": the next few due tasks/projects/events, regardless of which month is viewed —
  // always anchored to the real "now", not viewYear/viewMonth0.
  type UpcomingSource = { sortKey: number; item: UpcomingItemVM };
  const upcomingSources: UpcomingSource[] = [];
  for (const t of raw.tasks) {
    if (t.isCompleted || !t.dueDate || !taskMatchesMode(t.category, mode, scopeByName)) continue;
    const diff = daysUntil(new Date(t.dueDate), now);
    if (diff < 0) continue;
    const d = calendarDateFromDue(new Date(t.dueDate));
    upcomingSources.push({ sortKey: d.getTime(), item: { key: `t-${t.id}`, a: relativeUpcomingLabel(diff, d), b: t.title, c: t.category, hasC: true } });
  }
  for (const p of raw.projects) {
    if (p.isCompleted || !p.dueDate) continue;
    const diff = daysUntil(new Date(p.dueDate), now);
    if (diff < 0) continue;
    const d = calendarDateFromDue(new Date(p.dueDate));
    upcomingSources.push({ sortKey: d.getTime(), item: { key: `p-${p.id}`, a: relativeUpcomingLabel(diff, d), b: p.name, c: "Project", hasC: true } });
  }
  for (const e of visibleEvents) {
    if (dismissed.has(e.id)) continue;
    const start = new Date(e.start);
    const diff = zonedDaysUntil(start, now, raw.timeZone);
    if (start.getTime() < now.getTime() && diff !== 0) continue;
    upcomingSources.push({
      sortKey: start.getTime(),
      item: {
        key: `e-${e.id}`,
        a: relativeUpcomingLabel(diff, zonedCalendarDate(start, raw.timeZone)),
        b: e.title,
        c: `${e.allDay ? "All day" : formatEventTime(e.start, raw.timeZone)} · ${e.source}`,
        hasC: true,
      },
    });
  }
  upcomingSources.sort((a, b) => a.sortKey - b.sortKey);
  const upcoming = upcomingSources.slice(0, 3).map((s) => s.item);

  return { monthCells, monthLabel, year: viewYear, dayDetails, upcoming };
}
