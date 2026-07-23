// Client-safe (NO "server-only") pure derivation of the Taskbook view-models from raw entity
// rows. This is the single source of truth for how tasks/projects/habits/routines/categories/
// captures/calendar become the grouped, bucketed, ranked VMs the UI renders — run on the server
// for the initial page load AND on the client after every optimistic mutation or month-nav
// click, so a local edit re-buckets/re-counts/re-derives exactly the way a server round trip
// would have (this used to exclude the calendar rail; see git history if that distinction ever
// needs resurrecting).

import type { Task, Project, Habit, HabitCompletion, Routine, Category, VoiceCapture, DayPlanBlock, AiSuggestion, AiNote, Countdown } from "@prisma/client";
import { countdownYears, formatDuration, habitDateKey, habitStatus, nextCountdownOccurrenceMs, taskOrderCompare, MS_PER_DAY, ROUTINE_TICK_EXPIRY_MS } from "@/lib/shared";
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
  pad2,
  zonedCalendarDate,
  zonedDaysUntil,
  zonedMinutesOfDay,
  zonedNow,
  zonedYMD,
  type DueBucket,
  type MonthCell,
} from "@/lib/taskbookDates";
import { describeTaskRepeat, isRoutineDueToday, nextRoutineOccurrence, type TaskRepeatRule } from "@/lib/taskRecurrence";
import { DEFAULT_DAY_TEMPLATE } from "@/lib/dayTemplate";
import { packFlexible, placeLunch, type FlexItem, type Obstacle } from "@/lib/scheduler";
import type {
  CalendarEvent,
  CategoryOption,
  CountdownVM,
  DayDetailVM,
  HabitCardVM,
  Mode,
  MyDayBlockVM,
  MyDayLookaheadVM,
  MyDayTrayItemVM,
  MyDayVM,
  MyDayZoneVM,
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
  habitCompletions: HabitCompletion[]; // up to a year back; feeds habit status + the heatmap
  routines: RawRoutine[]; // top-level routines only, each with its subroutines nested
  categories: Category[];
  captures: VoiceCapture[];
  timeZone: string; // AppSettings.timeZone — governs due/reminder math and calendar display
  dismissedEventIds: string[]; // DismissedCalendarEvent ids, filtered out of the calendar view
  dayPlanBlocks: DayPlanBlock[]; // My Day placements, recent past + future (mirrors getDayPlanBlocks)
  suggestions: AiSuggestion[]; // PENDING AI planner suggestions (mirrors getActiveSuggestions)
  aiNotes: AiNote[]; // standing instructions for the AI planner (mirrors getAiNotes)
  countdowns: Countdown[]; // important-event countdowns (mirrors getCountdowns)
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
  habits: HabitCardVM[];
  habitAtRiskCount: number;
  countdowns: CountdownVM[];
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
const ORDINAL_WORDS: Record<number, string> = { 1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", [-1]: "Last" };
const WEEKDAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Human label for a WEEKLY_DAYS schedule's daysOfWeek (0=Sun..6=Sat): "Every day", "Weekdays",
// "Weekends", or a compact abbreviation list like "Mon, Wed, Fri".
function formatDaysOfWeek(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return "Every day";
  const isWeekdays = set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d));
  if (isWeekdays) return "Weekdays";
  if (set.size === 2 && set.has(0) && set.has(6)) return "Weekends";
  return [...days].sort((a, b) => a - b).map((d) => DOW_ABBR[d]).join(", ");
}

// The schedule description shown under a habit's title.
function habitScheduleLabel(habit: Pick<Habit, "scheduleType" | "targetCount" | "daysOfWeek">): string {
  if (habit.scheduleType === "WEEKLY_DAYS") return formatDaysOfWeek(habit.daysOfWeek);
  if (habit.scheduleType === "MONTHLY_COUNT") return `${habit.targetCount}× per month`;
  return `${habit.targetCount}× per week`;
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

// --- Task VMs ---

function toTaskVM(t: RawTask, projectNameById: Map<string, string>, now: Date): TaskItemVM {
  const due = t.dueDate ? new Date(t.dueDate) : null;
  const dueLabel = due ? formatDueLabel(due) : null;
  const repeatUntil = t.repeatUntil ? new Date(t.repeatUntil) : null;
  const repeatLabel = t.repeatFrequency
    ? describeTaskRepeat({
        frequency: t.repeatFrequency,
        interval: t.repeatInterval ?? 1,
        daysOfWeek: t.repeatDaysOfWeek,
        monthlyMode: t.repeatMonthlyMode ?? "DATE",
        dayOfMonth: t.repeatDayOfMonth,
        monthlyOrdinal: t.repeatMonthlyOrdinal,
        monthlyWeekday: t.repeatMonthlyWeekday,
      }) + (repeatUntil ? ` · until ${formatShortDate(calendarDateFromDue(repeatUntil))}` : "")
    : null;
  // A break is "active" while its resume date is still in the future (same calendar-day
  // convention as the due-bucket logic).
  const pausedUntil = t.pausedUntil ? new Date(t.pausedUntil) : null;
  const pauseActive = pausedUntil != null && daysUntil(pausedUntil, now) > 0;
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
    repeatUntilValue: toDateInputValue(repeatUntil),
    pausedUntilValue: toDateInputValue(pausedUntil),
    pausedLabel: pauseActive && pausedUntil ? `Paused until ${formatShortDate(calendarDateFromDue(pausedUntil))}` : null,
    section: t.section,
    sortOrder: t.sortOrder,
    reminderLeadMinutes: t.reminderLeadMinutes,
    durationMinutes: t.durationMinutes,
    durationLabel: t.durationMinutes != null ? formatDuration(t.durationMinutes) : null,
    blockedReason: t.blockedReason,
    blockedUntilValue: toDateInputValue(t.blockedUntil),
    blockedLabel: t.blockedReason
      ? `Waiting: ${t.blockedReason}${t.blockedUntil ? ` · until ${formatShortDate(calendarDateFromDue(new Date(t.blockedUntil)))}` : ""}`
      : null,
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
    const vm = toTaskVM(t, projectNameById, now);
    // While a break is active the task is bucketed/sorted by its resume date, so it drops out
    // of Overdue/Today and reappears as due when the break ends (like a paused routine skips).
    const realDue = t.dueDate ? new Date(t.dueDate) : null;
    const pausedUntil = t.pausedUntil ? new Date(t.pausedUntil) : null;
    const effectiveDue = pausedUntil && daysUntil(pausedUntil, now) > 0 ? pausedUntil : realDue;
    const b = bucketForDue(effectiveDue, now);
    if (!grouped.has(b)) grouped.set(b, []);
    grouped.get(b)!.push({ vm, dueMs: effectiveDue ? effectiveDue.getTime() : null, createdMs: new Date(t.createdAt).getTime() });
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
    const tasks = sorted.map((t) => toTaskVM(t, projectNameById, now));
    // Group by section, preserving first-appearance order; unsectioned tasks lead. With
    // sections toggled off the card renders one flat headingless group regardless of any
    // stray section values (the disable path clears them server-side).
    const sectionOrder: (string | null)[] = [null];
    const bySection = new Map<string | null, TaskItemVM[]>([[null, []]]);
    for (const t of tasks) {
      const key = p.sectionsEnabled ? t.section : null;
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
      durationMinutes: p.durationMinutes,
      durationLabel: p.durationMinutes != null ? formatDuration(p.durationMinutes) : null,
      done,
      total,
      progressPct,
      tasks,
      sectionsEnabled: p.sectionsEnabled,
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
      durationMinutes: r.durationMinutes,
      durationLabel: r.durationMinutes != null ? formatDuration(r.durationMinutes) : null,
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

  // Habits — completions grouped per habit into tz-local YYYY-MM-DD day-keys, then status,
  // progress and streak computed from those (see lib/shared.ts). One flat list, ranked so the
  // ones needing attention (at risk / lapsed / not yet done) float to the top.
  const completionKeysByHabit = new Map<string, string[]>();
  for (const c of raw.habitCompletions) {
    const key = habitDateKey(new Date(c.date), raw.timeZone);
    const list = completionKeysByHabit.get(c.habitId);
    if (list) list.push(key);
    else completionKeysByHabit.set(c.habitId, [key]);
  }

  const habitVMs: HabitCardVM[] = raw.habits.map((habit) => {
    const keys = completionKeysByHabit.get(habit.id) ?? [];
    const status = habitStatus(habit, new Set(keys), now, raw.timeZone);
    return {
      id: habit.id,
      title: habit.title,
      scheduleType: habit.scheduleType,
      targetCount: habit.targetCount,
      daysOfWeek: habit.daysOfWeek,
      streak: status.streak,
      atRisk: status.atRisk,
      lapsed: status.lapsed,
      isDoneToday: status.isDoneToday,
      progressDone: status.progressDone,
      progressTarget: status.progressTarget,
      detailLabel: habitScheduleLabel(habit),
      completedDates: [...keys].sort(),
      pauseStart: toDateInputValue(habit.pauseStart),
      pauseEnd: toDateInputValue(habit.pauseEnd),
      durationMinutes: habit.durationMinutes,
      durationLabel: habit.durationMinutes != null ? formatDuration(habit.durationMinutes) : null,
    };
  });
  const habitRank = (h: HabitCardVM) => (h.atRisk ? 0 : h.lapsed ? 1 : !h.isDoneToday ? 2 : 3);
  habitVMs.sort((a, b) => habitRank(a) - habitRank(b) || a.title.localeCompare(b.title));
  const habitAtRiskCount = habitVMs.filter((h) => h.atRisk).length;

  // Countdowns — one row per event, targeting its next occurrence, soonest first. One-offs
  // whose date has passed drop out here (their rows are swept by the notification cron).
  // Not mode-filtered: these are personal dates, visible in work and home alike.
  const countdownVMs: CountdownVM[] = [];
  for (const c of raw.countdowns) {
    const original = new Date(c.date);
    const occMs = nextCountdownOccurrenceMs(original, c.repeatsYearly, zonedToday);
    if (occMs < zonedToday) continue;
    const daysAway = Math.round((occMs - zonedToday) / MS_PER_DAY);
    const years = countdownYears(original, occMs);
    const dateLabel = formatShortDate(calendarDateFromDue(new Date(occMs)));
    countdownVMs.push({
      id: c.id,
      title: c.title,
      dateValue: toDateInputValue(original),
      repeatsYearly: c.repeatsYearly,
      daysAway,
      daysLabel: daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : `${daysAway} days`,
      detailLabel: c.repeatsYearly && years > 0 ? `${years} ${years === 1 ? "year" : "years"} · ${dateLabel}` : dateLabel,
    });
  }
  countdownVMs.sort((a, b) => a.daysAway - b.daysAway || a.title.localeCompare(b.title));

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
    source: c.source === "EMAIL" ? "email" : "voice",
    parseError: c.parseError,
  }));

  return {
    taskGroups,
    tasksRemainingToday,
    projectCards,
    activeProjectCount,
    routineList,
    routineTotalCount,
    habits: habitVMs,
    habitAtRiskCount,
    countdowns: countdownVMs,
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

// --- My Day (timeline day planner — see DayView and its MyDay* components) ---

// Base visible window; stretched (whole hours) when something falls outside it.
const MY_DAY_START_HOUR = 5;
const MY_DAY_END_HOUR = 21;
const DEFAULT_BLOCK_MINUTES = 30;
const MIN_EVENT_LAYOUT_MINUTES = 15;

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes >= 0 && minutes < 24 * 60 ? minutes : null;
}

function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const h12 = h24 % 12 || 12;
  const suffix = h24 < 12 ? "AM" : "PM";
  return mm === 0 ? `${h12} ${suffix}` : `${h12}:${pad2(mm)} ${suffix}`;
}

function formatClockRange(startMinutes: number, durationMinutes: number): string {
  return `${formatClock(startMinutes)} – ${formatClock(startMinutes + durationMinutes)}`;
}

// Classic day-calendar overlap layout: transitively-overlapping blocks form a cluster; within a
// cluster each block takes the first lane whose previous occupant has ended. Mutates col/cols.
function assignOverlapLanes(blocks: MyDayBlockVM[]): void {
  const sorted = [...blocks].sort(
    (a, b) => a.startMinutes - b.startMinutes || b.durationMinutes - a.durationMinutes
  );
  let cluster: MyDayBlockVM[] = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    for (const b of cluster) {
      let lane = laneEnds.findIndex((end) => end <= b.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = b.startMinutes + b.durationMinutes;
      b.col = lane;
    }
    for (const b of cluster) b.cols = laneEnds.length;
    cluster = [];
    clusterEnd = -1;
  };
  for (const b of sorted) {
    if (cluster.length && b.startMinutes >= clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.startMinutes + b.durationMinutes);
  }
  flush();
}

// Builds the My Day view for the selected calendar day: everything due/scheduled that day merged
// into one timeline (pinned times) + tray (placeable but untimed) + look-ahead (future tasks that
// could be done early). Pure and client-safe like the other derivers — runs on every optimistic
// edit, so completing/moving/pushing an item re-derives the whole day instantly.
export function deriveMyDay(
  raw: RawState,
  calendarEvents: CalendarEvent[],
  nowMs: number,
  viewYear: number,
  viewMonth0: number,
  day: number,
  mode: Mode
): MyDayVM {
  const dateKey = `${viewYear}-${pad2(viewMonth0 + 1)}-${pad2(day)}`;
  const now = new Date(nowMs);
  const todayYMD = zonedYMD(now, raw.timeZone);
  const isToday = todayYMD.year === viewYear && todayYMD.month0 === viewMonth0 && todayYMD.day === day;
  // Face-value UTC midnight of the viewed day — comparable to stored due dates / block dates.
  const viewedUtcMidnight = Date.UTC(viewYear, viewMonth0, day);
  const weekday = new Date(viewedUtcMidnight).getUTCDay();

  const scopeByName = categoryScopeMap(raw.categories);
  const projectNameById = new Map(raw.projects.map((p) => [p.id, p.name]));
  const dismissed = new Set(raw.dismissedEventIds);

  const timeline: MyDayBlockVM[] = [];
  const tray: MyDayTrayItemVM[] = [];
  const allDayEvents: MyDayVM["allDayEvents"] = [];

  // Items without a pinned time gather here first; after the fixed timeline is known, the
  // auto-scheduler packs the schedulable ones (has duration, not done) into free zone gaps and
  // the rest fall through to the tray. See lib/scheduler.ts.
  type FloatingCandidate = {
    tray: MyDayTrayItemVM;
    description: string | null;
    scope: "work" | "home" | "both";
    kindRank: number;
    orderKey: { sortOrder: number | null; dueMs: number | null; createdMs: number };
  };
  const floating: FloatingCandidate[] = [];

  // A task is actively blocked while its reason is set and the expected-clear date hasn't
  // arrived (no date = blocked indefinitely). On/after the clear date it schedules normally.
  const isBlockedOn = (t: Pick<Task, "blockedReason" | "blockedUntil">): boolean => {
    if (!t.blockedReason) return false;
    if (!t.blockedUntil) return true;
    const u = new Date(t.blockedUntil);
    return viewedUtcMidnight < Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  };

  // Does a calendar event cover the viewed day? All-day events span [start, end) in exclusive
  // ICS fashion (a multi-day "Summer Holiday" covers every day up to but not including end).
  const coversViewedDay = (e: CalendarEvent): boolean => {
    const s = zonedYMD(new Date(e.start), raw.timeZone);
    const en = zonedYMD(new Date(e.end), raw.timeZone);
    const startMid = Date.UTC(s.year, s.month0, s.day);
    const endMid = Date.UTC(en.year, en.month0, en.day);
    return viewedUtcMidnight >= startMid && (e.allDay ? viewedUtcMidnight < Math.max(endMid, startMid + MS_PER_DAY) : viewedUtcMidnight <= endMid);
  };

  const scopeOf = (category: string | null): "work" | "home" | "both" => {
    if (!category) return "both";
    const s = scopeByName.get(category.toLowerCase());
    if (s === "work" || s === "home") return s;
    if (s === "both") return "both";
    const lc = category.toLowerCase();
    return lc === "work" ? "work" : lc === "home" ? "home" : "both";
  };

  const makeBlock = (
    partial: Omit<MyDayBlockVM, "timeLabel" | "col" | "cols" | "durationMinutes"> & { durationMinutes: number }
  ): MyDayBlockVM => ({
    ...partial,
    timeLabel: formatClockRange(partial.startMinutes, partial.durationMinutes),
    col: 0,
    cols: 1,
  });

  // A block row covers its entity for the day: the entity's own due-time placement (or tray
  // entry) is suppressed so the two never render twice.
  const covered = new Set<string>();
  const blocksForDay = raw.dayPlanBlocks.filter((b) => new Date(b.date).getTime() === viewedUtcMidnight);
  for (const b of blocksForDay) covered.add(`${b.entityType}:${b.entityId}`);

  // Subtasks can be placed too ("do this piece today"), so task lookup spans both levels.
  const taskById = new Map<string, { task: Task; parent: RawTask | null }>();
  for (const t of raw.tasks) {
    taskById.set(t.id, { task: t, parent: null });
    for (const s of t.subtasks) taskById.set(s.id, { task: s, parent: t });
  }
  const habitById = new Map(raw.habits.map((h) => [h.id, h]));
  const routineById = new Map(raw.routines.map((r) => [r.id, r]));

  const completionKeysByHabit = new Map<string, Set<string>>();
  for (const c of raw.habitCompletions) {
    const key = habitDateKey(new Date(c.date), raw.timeZone);
    let set = completionKeysByHabit.get(c.habitId);
    if (!set) {
      set = new Set();
      completionKeysByHabit.set(c.habitId, set);
    }
    set.add(key);
  }

  // --- DayPlan blocks (explicit placements — they win over the entity's own schedule) ---
  for (const b of blocksForDay) {
    let title: string | null = null;
    let description: string | null = null;
    let isCompleted = false;
    let entityDuration: number | null = null;
    let category: string | null = null;
    let projectName: string | null = null;
    let kind: MyDayBlockVM["kind"];

    if (b.entityType === "TASK") {
      const hit = taskById.get(b.entityId);
      if (!hit) continue; // entity deleted out from under the block — skip (cron sweeps it)
      title = hit.task.title;
      description = hit.task.description;
      isCompleted = hit.task.isCompleted;
      entityDuration = hit.task.durationMinutes;
      category = hit.task.category;
      projectName = hit.task.projectId ? projectNameById.get(hit.task.projectId) ?? null : null;
      if (!taskMatchesMode(hit.task.category, mode, scopeByName)) continue;
      kind = "task";
    } else if (b.entityType === "PROJECT") {
      const p = raw.projects.find((x) => x.id === b.entityId);
      if (!p) continue;
      title = p.name;
      description = p.description;
      isCompleted = p.isCompleted;
      entityDuration = p.durationMinutes;
      kind = "project";
    } else if (b.entityType === "ROUTINE") {
      const r = routineById.get(b.entityId);
      if (!r) continue;
      title = r.title;
      isCompleted = isToday && isRoutineTickedNow(r, nowMs);
      entityDuration = r.durationMinutes;
      kind = "routine";
    } else {
      const h = habitById.get(b.entityId);
      if (!h) continue;
      title = h.title;
      isCompleted = completionKeysByHabit.get(h.id)?.has(dateKey) ?? false;
      entityDuration = h.durationMinutes;
      kind = "habit";
    }

    const duration = b.durationMinutes ?? entityDuration;
    const startMinutes = parseHHMM(b.startTime);
    if (startMinutes != null) {
      timeline.push(
        makeBlock({
          key: `plan-${b.id}`,
          kind,
          entityId: b.entityId,
          planBlockId: b.id,
          title,
          description,
          startMinutes,
          durationMinutes: duration ?? DEFAULT_BLOCK_MINUTES,
          hasExplicitDuration: duration != null,
          isCompleted,
          pinned: true,
          source: null,
          category,
          projectName,
        })
      );
    } else {
      floating.push({
        tray: {
          key: `plan-${b.id}`,
          kind,
          entityId: b.entityId,
          planBlockId: b.id,
          title,
          durationMinutes: duration,
          isCompleted,
          category,
          projectName,
          reason: duration == null ? "needs-duration" : "unscheduled",
          blockedReason: kind === "task" && taskById.get(b.entityId) && isBlockedOn(taskById.get(b.entityId)!.task) ? taskById.get(b.entityId)!.task.blockedReason : null,
        },
        description,
        scope: scopeOf(category),
        kindRank: kind === "task" ? 0 : kind === "project" ? 1 : kind === "routine" ? 2 : 3,
        orderKey: { sortOrder: b.sortOrder, dueMs: null, createdMs: new Date(b.createdAt).getTime() },
      });
    }
  }

  // --- Tasks due on the viewed day (top-level only — subtasks surface via their parent) ---
  for (const t of raw.tasks) {
    if (!t.dueDate || !taskMatchesMode(t.category, mode, scopeByName)) continue;
    if (covered.has(`TASK:${t.id}`)) continue;
    const due = new Date(t.dueDate);
    if (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) !== viewedUtcMidnight) continue;
    const projectName = t.projectId ? projectNameById.get(t.projectId) ?? null : null;
    const dueMinutes = due.getUTCHours() * 60 + due.getUTCMinutes(); // face-value clock time
    if (dueMinutes > 0) {
      timeline.push(
        makeBlock({
          key: `task-${t.id}`,
          kind: "task",
          entityId: t.id,
          planBlockId: null,
          title: t.title,
          description: t.description,
          startMinutes: dueMinutes,
          durationMinutes: t.durationMinutes ?? DEFAULT_BLOCK_MINUTES,
          hasExplicitDuration: t.durationMinutes != null,
          isCompleted: t.isCompleted,
          pinned: true,
          source: null,
          category: t.category,
          projectName,
        })
      );
    } else {
      floating.push({
        tray: {
          key: `task-${t.id}`,
          kind: "task",
          entityId: t.id,
          planBlockId: null,
          title: t.title,
          durationMinutes: t.durationMinutes,
          isCompleted: t.isCompleted,
          category: t.category,
          projectName,
          reason: t.durationMinutes == null ? "needs-duration" : "unscheduled",
          blockedReason: isBlockedOn(t) ? t.blockedReason : null,
        },
        description: t.description,
        scope: scopeOf(t.category),
        kindRank: 0,
        orderKey: { sortOrder: t.sortOrder, dueMs: new Date(t.dueDate).getTime(), createdMs: new Date(t.createdAt).getTime() },
      });
    }
  }

  // --- Projects due on the viewed day ---
  for (const p of raw.projects) {
    if (p.isCompleted || !p.dueDate || covered.has(`PROJECT:${p.id}`)) continue;
    const due = new Date(p.dueDate);
    if (Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) !== viewedUtcMidnight) continue;
    floating.push({
      tray: {
        key: `project-${p.id}`,
        kind: "project",
        entityId: p.id,
        planBlockId: null,
        title: p.name,
        durationMinutes: p.durationMinutes,
        isCompleted: p.isCompleted,
        category: null,
        projectName: null,
        reason: p.durationMinutes == null ? "needs-duration" : "unscheduled",
        blockedReason: null,
      },
      description: p.description,
      scope: "both",
      kindRank: 1,
      orderKey: { sortOrder: null, dueMs: new Date(p.dueDate).getTime(), createdMs: 0 },
    });
  }

  // --- Routines due on the viewed day, at their reminder time ---
  // The due-today check reads the passed Date's UTC getters as wall-clock fields, so a
  // face-value UTC date for the viewed day matches the zonedNow convention.
  const viewedFaceValue = new Date(viewedUtcMidnight);
  for (const r of raw.routines) {
    if (!r.isActive || covered.has(`ROUTINE:${r.id}`)) continue;
    if (r.pausedUntil && viewedUtcMidnight < new Date(r.pausedUntil).getTime()) continue;
    const rule: TaskRepeatRule = {
      frequency: r.frequency,
      interval: r.interval,
      daysOfWeek: r.daysOfWeek,
      monthlyMode: r.monthlyMode,
      dayOfMonth: r.dayOfMonth,
      monthlyOrdinal: r.monthlyOrdinal,
      monthlyWeekday: r.monthlyWeekday,
    };
    if (!isRoutineDueToday(rule, viewedFaceValue)) continue;
    const startMinutes = parseHHMM(r.reminderTime);
    if (startMinutes == null) continue;
    timeline.push(
      makeBlock({
        key: `routine-${r.id}`,
        kind: "routine",
        entityId: r.id,
        planBlockId: null,
        title: r.title,
        description: r.subroutines.length ? r.subroutines.map((s) => s.title).join(" · ") : null,
        startMinutes,
        durationMinutes: r.durationMinutes ?? DEFAULT_BLOCK_MINUTES,
        hasExplicitDuration: r.durationMinutes != null,
        isCompleted: isToday && isRoutineTickedNow(r, nowMs),
        pinned: true,
        source: null,
        category: null,
        projectName: null,
      })
    );
  }

  // --- Habits scheduled on the viewed day ---
  for (const h of raw.habits) {
    if (covered.has(`HABIT:${h.id}`)) continue;
    const doneThatDay = completionKeysByHabit.get(h.id)?.has(dateKey) ?? false;
    if (h.scheduleType === "WEEKLY_DAYS") {
      if (!h.daysOfWeek.includes(weekday)) continue;
    } else {
      // Count-based habits have no fixed days — surface one only on today, while its current
      // period's target is still unmet (done-today ones stay visible as ticked).
      if (!isToday) continue;
      const status = habitStatus(h, completionKeysByHabit.get(h.id) ?? new Set(), now, raw.timeZone);
      if (!status.isDoneToday && status.progressDone >= status.progressTarget) continue;
    }
    floating.push({
      tray: {
        key: `habit-${h.id}`,
        kind: "habit",
        entityId: h.id,
        planBlockId: null,
        title: h.title,
        durationMinutes: h.durationMinutes,
        isCompleted: doneThatDay,
        category: null,
        projectName: null,
        reason: h.durationMinutes == null ? "needs-duration" : "unscheduled",
        blockedReason: null,
      },
      description: null,
      scope: "both",
      kindRank: 3,
      orderKey: { sortOrder: null, dueMs: null, createdMs: 0 },
    });
  }

  // --- Calendar (ICS) events on the viewed day ---
  for (const e of calendarEvents) {
    if (dismissed.has(e.id) || !eventMatchesMode(e.source, mode)) continue;
    // All-day events use a coverage check so multi-day ones (e.g. "Summer Holiday") appear on
    // every day they span, not just their first.
    if (e.allDay) {
      if (coversViewedDay(e)) allDayEvents.push({ id: e.id, title: e.title, source: e.source });
      continue;
    }
    const start = new Date(e.start);
    const ymd = zonedYMD(start, raw.timeZone);
    if (ymd.year !== viewYear || ymd.month0 !== viewMonth0 || ymd.day !== day) continue;
    const startMinutes = zonedMinutesOfDay(start, raw.timeZone);
    const realDuration = Math.round((new Date(e.end).getTime() - start.getTime()) / 60000);
    timeline.push(
      makeBlock({
        key: `event-${e.id}`,
        kind: "event",
        entityId: e.id,
        planBlockId: null,
        title: e.title,
        description: e.location,
        startMinutes,
        durationMinutes: Math.max(realDuration, MIN_EVENT_LAYOUT_MINUTES),
        hasExplicitDuration: true,
        isCompleted: false,
        pinned: true,
        source: e.source,
        category: null,
        projectName: null,
      })
    );
  }

  // --- Wellbeing day template: zone bands + snack/lunch anchors (workdays only) ---
  // Holiday awareness: an (undismissed) calendar event whose title reads like a holiday and
  // covers the viewed day — e.g. the multi-day "Summer Holiday" on the work calendar — turns a
  // weekday into an off-day: no work zones, no snack/lunch anchors.
  const HOLIDAY_TITLE = /holiday|vacation|half\s*term|no school|school closed|public holiday|day off|annual leave/i;
  const isHoliday = calendarEvents.some((e) => !dismissed.has(e.id) && HOLIDAY_TITLE.test(e.title) && coversViewedDay(e));
  const template = DEFAULT_DAY_TEMPLATE;
  const isWorkday = template.workdays.includes(weekday) && !isHoliday;
  const templateZones = isWorkday ? template.workdayZones : template.offdayZones;
  const zones: MyDayZoneVM[] = templateZones
    .filter((z) => z.label)
    .map((z) => ({ key: z.key, label: z.label, startMinutes: z.startMinutes, endMinutes: z.endMinutes }));

  const todayUtcMidnight = Date.UTC(todayYMD.year, todayYMD.month0, todayYMD.day);
  const isPast = viewedUtcMidnight < todayUtcMidnight;
  const nowMinutes = zonedMinutesOfDay(now, raw.timeZone);

  const fixedObstacles: Obstacle[] = timeline.map((b) => ({
    startMinutes: b.startMinutes,
    endMinutes: b.startMinutes + b.durationMinutes,
  }));

  if (isWorkday) {
    const templateBlock = (slug: string, title: string, startMinutes: number, durationMinutes: number) =>
      makeBlock({
        key: `template-${slug}`,
        kind: "template",
        entityId: slug,
        planBlockId: null,
        title,
        description: null,
        startMinutes,
        durationMinutes,
        hasExplicitDuration: true,
        isCompleted: false,
        pinned: true,
        source: null,
        category: null,
        projectName: null,
      });

    // Lunch floats inside its window to dodge meetings; ordering it happens 40 minutes ahead.
    const lunchStart = placeLunch(template.lunch, fixedObstacles, 0);
    const orderStart = lunchStart - template.lunch.orderLeadMinutes;
    const snack = templateBlock("snack", template.snack.label, template.snack.startMinutes, template.snack.durationMinutes);
    const lunch = templateBlock("lunch", "Lunch", lunchStart, template.lunch.durationMinutes);
    const order = templateBlock("order-lunch", "Order lunch", orderStart, template.lunch.orderDurationMinutes);
    timeline.push(snack, lunch, order);
    for (const b of [snack, lunch, order]) {
      fixedObstacles.push({ startMinutes: b.startMinutes, endMinutes: b.startMinutes + b.durationMinutes });
    }
  }

  // --- Auto-schedule the floating pool ---
  // Schedulable = not done, not blocked, and has a duration. Completed items never resurface in
  // the tray (they only remain visible as pinned timeline blocks). Blocked items sit in the tray
  // with their waiting-on note. Past days never pack (they're a record, not a plan); today packs
  // from "now" so unfinished items keep sliding forward as time passes.
  const schedulable = new Map<string, FloatingCandidate>();
  for (const f of floating) {
    if (f.tray.isCompleted) continue;
    if (f.tray.blockedReason) {
      tray.push({ ...f.tray, reason: "blocked" });
    } else if (isPast || f.tray.durationMinutes == null) {
      tray.push(f.tray);
    } else {
      schedulable.set(f.tray.key, f);
    }
  }

  const pool = [...schedulable.values()].sort(
    (a, b) => a.kindRank - b.kindRank || taskOrderCompare(a.orderKey, b.orderKey)
  );
  const flexItems: FlexItem[] = pool.map((f) => ({
    key: f.tray.key,
    durationMinutes: f.tray.durationMinutes!,
    scope: f.scope,
  }));
  const { placed, overflow } = packFlexible(flexItems, templateZones, fixedObstacles, isToday ? nowMinutes : 0);

  for (const f of pool) {
    const start = placed.get(f.tray.key);
    if (start != null) {
      timeline.push(
        makeBlock({
          key: f.tray.key,
          kind: f.tray.kind,
          entityId: f.tray.entityId,
          planBlockId: f.tray.planBlockId,
          title: f.tray.title,
          description: f.description,
          startMinutes: start,
          durationMinutes: f.tray.durationMinutes!,
          hasExplicitDuration: true,
          isCompleted: false,
          pinned: false,
          source: null,
          category: f.tray.category,
          projectName: f.tray.projectName,
        })
      );
    } else if (overflow.has(f.tray.key)) {
      tray.push({ ...f.tray, reason: "no-fit" });
    }
  }

  // --- Look-ahead: future tasks that could be pulled forward ---
  const lookahead: MyDayLookaheadVM[] = [];
  for (const t of raw.tasks) {
    if (t.isCompleted || !t.dueDate || !taskMatchesMode(t.category, mode, scopeByName)) continue;
    if (covered.has(`TASK:${t.id}`) || isBlockedOn(t)) continue; // blocked tasks can't be pulled forward
    const due = new Date(t.dueDate);
    const dueUtcMidnight = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    const daysAway = Math.round((dueUtcMidnight - viewedUtcMidnight) / MS_PER_DAY);
    if (daysAway < 1 || daysAway > 7) continue;
    lookahead.push({
      taskId: t.id,
      title: t.title,
      dueLabel: formatShortDate(calendarDateFromDue(due)),
      daysAway,
      projectName: t.projectId ? projectNameById.get(t.projectId) ?? null : null,
      durationMinutes: t.durationMinutes,
    });
  }
  lookahead.sort((a, b) => a.daysAway - b.daysAway || a.title.localeCompare(b.title));
  const cappedLookahead = lookahead.slice(0, 10);

  // Tray ordering: actionable-first (incomplete before done), then by kind for stable grouping.
  const trayKindRank: Record<MyDayTrayItemVM["kind"], number> = { task: 0, project: 1, routine: 2, habit: 3, event: 4, template: 5 };
  tray.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || trayKindRank[a.kind] - trayKindRank[b.kind] || a.title.localeCompare(b.title));

  assignOverlapLanes(timeline);
  timeline.sort((a, b) => a.startMinutes - b.startMinutes || a.col - b.col);

  // Stretch the visible window (whole hours) to fit outliers.
  let startHour = MY_DAY_START_HOUR;
  let endHour = MY_DAY_END_HOUR;
  for (const b of timeline) {
    startHour = Math.min(startHour, Math.floor(b.startMinutes / 60));
    endHour = Math.max(endHour, Math.ceil((b.startMinutes + b.durationMinutes) / 60));
  }
  startHour = Math.max(0, startHour);
  endHour = Math.min(24, endHour);

  return { dateKey, isToday, startHour, endHour, zones, allDayEvents, timeline, tray, lookahead: cappedLookahead };
}
