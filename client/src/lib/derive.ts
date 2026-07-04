// Client-safe (NO "server-only") pure derivation of the Taskbook entity view-models from raw
// entity rows. This is the single source of truth for how tasks/projects/habits/routines/
// categories/captures become the grouped, bucketed, ranked VMs the UI renders — run on the
// server for the initial page load AND on the client after every optimistic mutation, so an
// instant local edit re-buckets/re-counts exactly the way a server round trip would have.
//
// The calendar rail (month cells, day details, "upcoming") is NOT derived here — it stays
// server-computed in page.tsx and only refreshes on focus, since it isn't part of the
// fast-interaction path.

import type { Task, Project, Habit, Routine, Category, VoiceCapture } from "@prisma/client";
import {
  bucketForDue,
  calendarDateFromDue,
  formatDueLabel,
  formatShortDate,
  localDaysUntil,
  pad2,
  type DueBucket,
} from "@/lib/taskbookDates";
import { describeTaskRepeat } from "@/lib/taskRecurrence";
import type {
  CategoryOption,
  HabitCardVM,
  ProjectCardVM,
  ProjectOption,
  RoutineItemVM,
  TaskGroupVM,
  TaskItemVM,
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
};

// The entity slice of TaskbookData — everything derived here. The remaining (calendar) fields
// are merged in by the caller from the server snapshot.
export type DerivedEntities = {
  taskGroups: TaskGroupVM[];
  tasksRemainingToday: number;
  projectCards: ProjectCardVM[];
  activeProjectCount: number;
  routineDaily: RoutineItemVM[];
  routineScheduled: RoutineItemVM[];
  routineTotalCount: number;
  habitFeatured: HabitCardVM | null;
  habitSuggested: HabitCardVM[];
  habitOnTrack: HabitCardVM[];
  habitAtRiskCount: number;
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  pendingCaptures: VoiceCaptureVM[];
};

// --- Constants mirrored from lib/api.ts (which is server-only and can't be imported here) ---

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INTERVAL_UNIT_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30 };
export const ROUTINE_TICK_EXPIRY_MS = 60 * 60 * 1000;

function habitWindowDays(habit: Pick<Habit, "intervalValue" | "intervalUnit">): number {
  return habit.intervalValue * INTERVAL_UNIT_DAYS[habit.intervalUnit];
}

function habitPeriodIndex(date: Date, windowDays: number) {
  return Math.floor(date.getTime() / (MS_PER_DAY * windowDays));
}

export function isRoutineTickedNow(routine: Pick<Routine, "lastCompletedAt">, nowMs: number): boolean {
  if (!routine.lastCompletedAt) return false;
  return nowMs - new Date(routine.lastCompletedAt).getTime() < ROUTINE_TICK_EXPIRY_MS;
}

// Mirrors lib/api.ts's combineDueDateTime so optimistic task/subtask edits store the same
// UTC-midnight-plus-face-value-time encoding the server would have written.
export function combineDueDateTime(dueDate: string, dueTime?: string | null): Date {
  const time = dueTime && /^\d{2}:\d{2}$/.test(dueTime) ? dueTime : "00:00";
  return new Date(`${dueDate}T${time}:00.000Z`);
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
  };
}

const BUCKET_ORDER: DueBucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

function bucketLabel(b: DueBucket, now: Date, year: number, month0: number, todayDay: number): string {
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

export function deriveEntities(raw: RawState, nowMs: number): DerivedEntities {
  const now = new Date(nowMs);
  const year = now.getFullYear();
  const month0 = now.getMonth();
  const todayDay = now.getDate();

  // Tasks — grouped by due bucket.
  const projectNameById = new Map(raw.projects.map((p) => [p.id, p.name]));
  const grouped = new Map<DueBucket, TaskItemVM[]>();
  for (const t of raw.tasks) {
    const vm = toTaskVM(t, projectNameById);
    const b = bucketForDue(t.dueDate ? new Date(t.dueDate) : null, now);
    if (!grouped.has(b)) grouped.set(b, []);
    grouped.get(b)!.push(vm);
  }
  const taskGroups: TaskGroupVM[] = BUCKET_ORDER.filter((b) => grouped.has(b)).map((b) => ({
    key: b,
    label: bucketLabel(b, now, year, month0, todayDay),
    tasks: grouped.get(b)!,
  }));
  const tasksRemainingToday = (grouped.get("today") ?? []).filter((t) => !t.isCompleted).length;

  // Projects.
  const tasksByProject = new Map<string, RawTask[]>();
  for (const t of raw.tasks) {
    if (!t.projectId) continue;
    if (!tasksByProject.has(t.projectId)) tasksByProject.set(t.projectId, []);
    tasksByProject.get(t.projectId)!.push(t);
  }
  const projectCards: ProjectCardVM[] = raw.projects.map((p) => {
    const items = tasksByProject.get(p.id) ?? [];
    const done = items.filter((t) => t.isCompleted).length;
    const total = items.length;
    const progressPct = total ? Math.round((done / total) * 100) : 0;
    const previewSource = [...items].sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted));
    const preview = previewSource.slice(0, 3).map((t) => ({
      id: t.id,
      title: t.title,
      isCompleted: t.isCompleted,
      dueLabel: t.dueDate ? formatShortDate(calendarDateFromDue(new Date(t.dueDate))) : null,
    }));
    const moreCount = Math.max(0, total - preview.length);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      dueDateValue: toDateInputValue(p.dueDate),
      dueLabel: p.dueDate ? formatShortDate(calendarDateFromDue(new Date(p.dueDate))) : null,
      done,
      total,
      progressPct,
      preview,
      moreCount,
    };
  });
  const activeProjectCount = raw.projects.filter((p) => !p.isCompleted).length;

  // Routines.
  const routineVMs: RoutineItemVM[] = raw.routines.map((r) => ({
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
    subroutines: r.subroutines.map((s) => ({ id: s.id, title: s.title })),
  }));
  const routineDaily = routineVMs.filter((r) => r.frequency === "DAILY" && r.interval === 1);
  const routineScheduled = routineVMs.filter((r) => r.frequency !== "DAILY" || r.interval !== 1);
  const routineTotalCount = routineVMs.length;

  // Habits — status computed, then ranked by urgency (soonest to break its streak first).
  const habitStatuses = raw.habits
    .map((habit) => {
      const windowDays = habitWindowDays(habit);
      const nowPeriod = habitPeriodIndex(now, windowDays);
      const periodEndsAt = new Date((nowPeriod + 1) * windowDays * MS_PER_DAY);
      const isDoneThisPeriod =
        habit.lastCompletedDate != null &&
        habitPeriodIndex(new Date(habit.lastCompletedDate), windowDays) === nowPeriod;
      const daysRemaining = (periodEndsAt.getTime() - now.getTime()) / MS_PER_DAY;
      return { habit, daysRemaining, isDoneThisPeriod, atRisk: !isDoneThisPeriod && daysRemaining <= 1 };
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
    const daysLabel = hs.daysRemaining <= 1 ? "due tomorrow" : `due in ${Math.ceil(hs.daysRemaining)} days`;
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
    isDoneThisPeriod: hs.isDoneThisPeriod,
    detailLabel: habitDetailLabel(hs),
  }));
  const habitFeatured = habitVMs[0] ?? null;
  const rest = habitVMs.slice(1);
  const habitSuggested = rest.filter((h) => !h.isDoneThisPeriod);
  const habitOnTrack = rest.filter((h) => h.isDoneThisPeriod);
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
    routineDaily,
    routineScheduled,
    routineTotalCount,
    habitFeatured,
    habitSuggested,
    habitOnTrack,
    habitAtRiskCount,
    projectOptions: raw.projects.map((p) => ({ id: p.id, name: p.name })),
    categoryOptions: raw.categories.map((c) => ({ id: c.id, name: c.name })),
    pendingCaptures,
  };
}
