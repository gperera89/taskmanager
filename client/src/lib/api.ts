import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextOccurrence, resolveTaskRepeat, type TaskRepeatRule } from "@/lib/taskRecurrence";
import { DEFAULT_TIME_ZONE, SUPPORTED_TIME_ZONES } from "@/lib/taskbookDates";
import {
  combineDueDateTime,
  habitDateKey,
  MS_PER_DAY,
  NO_REPEAT,
} from "@/lib/shared";

export type { Task, Project, Habit, HabitCompletion, Routine, Category, CategoryScope, CompletionLog, HabitScheduleType, RoutineFrequency, RoutineMonthlyMode, CapturedKind, CaptureSource } from "@prisma/client";
export { ROUTINE_TICK_EXPIRY_MS } from "@/lib/shared";
import { ROUTINE_TICK_EXPIRY_MS } from "@/lib/shared";
import type { CapturedKind, CaptureSource, CategoryScope, Habit, HabitScheduleType, Routine, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";

const HABIT_SCHEDULE_TYPES: HabitScheduleType[] = ["WEEKLY_DAYS", "WEEKLY_COUNT", "MONTHLY_COUNT"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];
const CATEGORY_SCOPES: CategoryScope[] = ["WORK", "HOME", "NONE"];

// Completed tasks older than this stop being fetched by getTasks entirely — they remain in
// the database (and in CompletionLog) but no longer flow through derive on every render.
const COMPLETED_TASK_RETENTION_MS = 30 * MS_PER_DAY;

// --- Completion log (the Logbook's data source) ---

function logCompletion(entityType: CapturedKind, entityId: string, title: string, auto = false) {
  return prisma.completionLog.create({ data: { entityType, entityId, title, auto } });
}

// Un-completing something shortly after completing it shouldn't leave a phantom history row —
// remove the most recent log entry for the entity if it's within the take-back window.
const LOG_TAKEBACK_MS = 24 * 60 * 60 * 1000;

async function retractLatestCompletion(entityType: CapturedKind, entityId: string) {
  const latest = await prisma.completionLog.findFirst({
    where: { entityType, entityId, completedAt: { gte: new Date(Date.now() - LOG_TAKEBACK_MS) } },
    orderBy: { completedAt: "desc" },
  });
  if (latest) await prisma.completionLog.delete({ where: { id: latest.id } });
}

export function getCompletionLogs(input: { before?: Date; limit?: number }) {
  return prisma.completionLog.findMany({
    where: input.before ? { completedAt: { lt: input.before } } : undefined,
    orderBy: { completedAt: "desc" },
    take: input.limit ?? 100,
  });
}

export function countCompletionsSince(since: Date) {
  return prisma.completionLog.count({ where: { completedAt: { gte: since } } });
}

// Prisma throws P2025 when the record targeted by update/delete doesn't exist.
async function notFoundAsError<T>(notFoundMessage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new Error(notFoundMessage);
    }
    throw err;
  }
}

// Top-level tasks only: subtasks are fetched nested so the to-do list can expand a task
// into its own children without a second round trip. Tasks completed more than 30 days ago
// are archived out of this fetch (they stay in the DB and the Logbook).
export const getTasks = () =>
  prisma.task.findMany({
    where: {
      parentId: null,
      OR: [{ isCompleted: false }, { completedAt: null }, { completedAt: { gte: new Date(Date.now() - COMPLETED_TASK_RETENTION_MS) } }],
    },
    include: { subtasks: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

export type TaskRepeatInput = {
  frequency: RoutineFrequency;
  interval?: number;
  daysOfWeek?: number[];
  monthlyMode?: RoutineMonthlyMode;
  dayOfMonth?: number | null;
  monthlyOrdinal?: number | null;
  monthlyWeekday?: number | null;
};

function repeatToPrismaData(repeat: TaskRepeatInput | null) {
  if (!repeat) return NO_REPEAT;
  const resolved = resolveTaskRepeat(repeat);
  return resolved;
}

export function createTask(input: {
  title: string;
  category: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  repeat?: TaskRepeatInput | null;
  section?: string | null;
  sortOrder?: number | null;
  reminderLeadMinutes?: number | null;
  durationMinutes?: number | null;
}) {
  const title = input.title.trim();
  const category = input.category.trim();
  if (!title || !category) throw new Error("Title and category are required");

  return prisma.task.create({
    data: {
      title,
      category,
      description: input.description || null,
      dueDate: input.dueDate ? combineDueDateTime(input.dueDate, input.dueTime) : null,
      projectId: input.projectId || null,
      parentId: input.parentId || null,
      section: input.section || null,
      sortOrder: input.sortOrder ?? null,
      reminderLeadMinutes: input.reminderLeadMinutes ?? null,
      durationMinutes: input.durationMinutes ?? null,
      ...repeatToPrismaData(input.repeat ?? null),
    },
  });
}

export function updateTask(
  id: string,
  input: Partial<{
    title: string;
    category: string;
    description: string | null;
    dueDate: string | null;
    dueTime: string | null;
    isCompleted: boolean;
    projectId: string | null;
    parentId: string | null;
    repeat: TaskRepeatInput | null;
    section: string | null;
    reminderLeadMinutes: number | null;
    durationMinutes: number | null;
    blockedReason: string | null;
    blockedUntil: string | null; // "YYYY-MM-DD"
  }>
) {
  return notFoundAsError("Task not found", () =>
    prisma.task.update({
      where: { id },
      data: {
        title: input.title,
        category: input.category,
        // undefined = field not provided (leave as-is); null/"" = explicitly cleared.
        description: input.description === undefined ? undefined : input.description || null,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? combineDueDateTime(input.dueDate, input.dueTime) : null,
        // A changed due date is a new deadline to notify about.
        notifiedAt: input.dueDate === undefined ? undefined : null,
        isCompleted: input.isCompleted,
        projectId: input.projectId === undefined ? undefined : input.projectId || null,
        parentId: input.parentId === undefined ? undefined : input.parentId || null,
        section: input.section === undefined ? undefined : input.section || null,
        reminderLeadMinutes: input.reminderLeadMinutes,
        durationMinutes: input.durationMinutes,
        blockedReason: input.blockedReason === undefined ? undefined : input.blockedReason || null,
        blockedUntil:
          input.blockedUntil === undefined ? undefined : input.blockedUntil ? combineDueDateTime(input.blockedUntil) : null,
        ...(input.repeat === undefined ? {} : repeatToPrismaData(input.repeat)),
      },
    })
  );
}

// Rewrites the manual order of a whole group (a due bucket or a project section) in one
// transaction: sortOrder = index * 1024, leaving room for future midpoint inserts.
export function reorderTasks(ids: string[]) {
  return prisma.$transaction(
    ids.map((id, i) => prisma.task.update({ where: { id }, data: { sortOrder: (i + 1) * 1024 } }))
  );
}

// Moves an overdue/today task's due date forward, keeping any explicit time-of-day. Used by
// the in-app snooze menu and the ntfy notification action button.
export async function snoozeTask(id: string, days: number) {
  return notFoundAsError("Task not found", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id } });
    const base = task.dueDate ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const next = new Date(base.getTime() + days * MS_PER_DAY);
    return prisma.task.update({ where: { id }, data: { dueDate: next, notifiedAt: null } });
  });
}

export async function deleteTask(id: string) {
  // Subtasks cascade-delete with their parent (see schema: parent relation onDelete: Cascade).
  const task = await notFoundAsError("Task not found", () => prisma.task.delete({ where: { id } }));
  await deleteDayPlanBlocksFor("TASK", id);
  return task;
}

// Completing a repeating task rolls its due date forward to the next occurrence in place
// (isCompleted stays false) rather than marking it done — mirrors how Routines tick and
// reset instead of leaving a trail of completed rows. Non-repeating tasks just toggle normally.
export async function toggleTaskCompletion(id: string, isCompleted: boolean) {
  if (isCompleted) {
    // Un-completing: clear the completion stamp and take back the (recent) history row.
    return notFoundAsError("Task not found", async () => {
      const task = await prisma.task.update({ where: { id }, data: { isCompleted: false, completedAt: null } });
      await retractLatestCompletion("TASK", id);
      return task;
    });
  }

  return notFoundAsError("Task not found", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id } });
    // Both branches record history — a repeating task's roll-forward otherwise leaves no
    // trace that the occurrence was ever done.
    await logCompletion("TASK", task.id, task.title);
    if (task.repeatFrequency && task.dueDate) {
      const rule: TaskRepeatRule = {
        frequency: task.repeatFrequency,
        interval: task.repeatInterval ?? 1,
        daysOfWeek: task.repeatDaysOfWeek,
        monthlyMode: task.repeatMonthlyMode ?? "DATE",
        dayOfMonth: task.repeatDayOfMonth,
        monthlyOrdinal: task.repeatMonthlyOrdinal,
        monthlyWeekday: task.repeatMonthlyWeekday,
      };
      const next = nextOccurrence(task.dueDate, rule);
      return prisma.task.update({ where: { id }, data: { dueDate: next, isCompleted: false, notifiedAt: null } });
    }
    return prisma.task.update({ where: { id }, data: { isCompleted: true, completedAt: new Date() } });
  });
}

export const getProjects = () => prisma.project.findMany();

export function createProject(input: { name: string; description?: string | null; dueDate?: string | null; reminderLeadMinutes?: number | null; durationMinutes?: number | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");

  return prisma.project.create({
    data: {
      name,
      description: input.description,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      reminderLeadMinutes: input.reminderLeadMinutes ?? null,
      durationMinutes: input.durationMinutes ?? null,
    },
  });
}

export function updateProject(
  id: string,
  input: Partial<{ name: string; description: string | null; isCompleted: boolean; dueDate: string | null; reminderLeadMinutes: number | null; durationMinutes: number | null }>
) {
  return notFoundAsError("Project not found", async () => {
    const project = await prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        isCompleted: input.isCompleted,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
        // A changed due date is a new deadline to notify about.
        notifiedAt: input.dueDate === undefined ? undefined : null,
        reminderLeadMinutes: input.reminderLeadMinutes,
        durationMinutes: input.durationMinutes,
      },
    });
    if (input.isCompleted === true) await logCompletion("PROJECT", project.id, project.name);
    else if (input.isCompleted === false) await retractLatestCompletion("PROJECT", project.id);
    return project;
  });
}

// Toggle Things-style sections on a project's card (the "Create sections"/"Remove sections"
// button). Disabling also clears every task's section assignment so re-enabling starts fresh.
export async function setProjectSections(id: string, enabled: boolean) {
  await notFoundAsError("Project not found", () =>
    prisma.project.update({ where: { id }, data: { sectionsEnabled: enabled } })
  );
  if (!enabled) await prisma.task.updateMany({ where: { projectId: id }, data: { section: null } });
}

// "New from template": copies a project and its task tree (sections, categories, descriptions,
// repeat rules and manual order carry over; completion state and dates are reset — a template's
// dates would be stale by definition).
export async function duplicateProject(id: string, name?: string | null) {
  return notFoundAsError("Project not found", async () => {
    const source = await prisma.project.findUniqueOrThrow({
      where: { id },
      include: { tasks: { include: { subtasks: true } } },
    });
    const project = await prisma.project.create({
      data: {
        name: name?.trim() || `${source.name} copy`,
        description: source.description,
        durationMinutes: source.durationMinutes,
        sectionsEnabled: source.sectionsEnabled,
      },
    });
    // Only top-level tasks carry their subtasks; a subtask row also appears in source.tasks
    // (it has projectId? no — subtasks created via addTask carry projectId only if set).
    const topLevel = source.tasks.filter((t) => t.parentId === null);
    for (const t of topLevel) {
      const created = await prisma.task.create({
        data: {
          title: t.title,
          category: t.category,
          description: t.description,
          projectId: project.id,
          section: t.section,
          sortOrder: t.sortOrder,
          reminderLeadMinutes: t.reminderLeadMinutes,
          durationMinutes: t.durationMinutes,
          repeatFrequency: t.repeatFrequency,
          repeatInterval: t.repeatInterval,
          repeatDaysOfWeek: t.repeatDaysOfWeek,
          repeatMonthlyMode: t.repeatMonthlyMode,
          repeatDayOfMonth: t.repeatDayOfMonth,
          repeatMonthlyOrdinal: t.repeatMonthlyOrdinal,
          repeatMonthlyWeekday: t.repeatMonthlyWeekday,
        },
      });
      if (t.subtasks.length) {
        await prisma.task.createMany({
          data: t.subtasks.map((s) => ({
            title: s.title,
            category: s.category,
            description: s.description,
            parentId: created.id,
            sortOrder: s.sortOrder,
          })),
        });
      }
    }
    return project;
  });
}

export async function deleteProject(id: string) {
  const project = await notFoundAsError("Project not found", () => prisma.project.delete({ where: { id } }));
  await deleteDayPlanBlocksFor("PROJECT", id);
  return project;
}

// --- Countdowns (important-event countdowns shown in the calendar rail) ---

export const getCountdowns = () => prisma.countdown.findMany({ orderBy: { createdAt: "asc" } });

export function createCountdown(input: { title: string; date: string; repeatsYearly: boolean }) {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  return prisma.countdown.create({
    data: { title, date: combineDueDateTime(input.date), repeatsYearly: input.repeatsYearly },
  });
}

export function updateCountdown(id: string, input: { title: string; date: string; repeatsYearly: boolean }) {
  // Any edit re-arms both pushes for the (possibly new) occurrence — same convention as a
  // changed dueDate clearing Task.notifiedAt.
  return notFoundAsError("Countdown not found", () =>
    prisma.countdown.update({
      where: { id },
      data: {
        title: input.title.trim(),
        date: combineDueDateTime(input.date),
        repeatsYearly: input.repeatsYearly,
        notifiedHeadsUpFor: null,
        notifiedOnDayFor: null,
      },
    })
  );
}

export async function deleteCountdown(id: string) {
  await notFoundAsError("Countdown not found", () => prisma.countdown.delete({ where: { id } }));
}

export function markCountdownNotified(id: string, kind: "headsUp" | "onDay", occurrence: Date) {
  return prisma.countdown.update({
    where: { id },
    data: kind === "headsUp" ? { notifiedHeadsUpFor: occurrence } : { notifiedOnDayFor: occurrence },
  });
}

// One-off countdowns are over once their day has passed — sweep them a day later (the grace
// day keeps "Today" visible for the whole calendar date in any timezone).
export function sweepPastCountdowns(now: Date) {
  return prisma.countdown.deleteMany({
    where: { repeatsYearly: false, date: { lt: new Date(now.getTime() - MS_PER_DAY) } },
  });
}

export const getHabits = () => prisma.habit.findMany();

// All habit completions within the last `days` (a year by default). Single-user app, so this is
// a small set — loaded into the client store and used for status, progress, and the heatmap.
export function getHabitCompletions(days = 366) {
  const since = new Date(Date.now() - days * MS_PER_DAY);
  return prisma.habitCompletion.findMany({ where: { date: { gte: since } }, orderBy: { date: "asc" } });
}

type HabitScheduleInput = {
  scheduleType: HabitScheduleType;
  targetCount: number;
  daysOfWeek: number[];
};

// Resolves the schedule fields that actually apply to `scheduleType`, nulling out whichever ones
// don't (a count-based habit has no daysOfWeek; a days-based habit ignores targetCount) so stale
// values from a previous edit never linger. Throws on invalid input.
function resolveHabitSchedule(input: HabitScheduleInput): { scheduleType: HabitScheduleType; targetCount: number; daysOfWeek: number[] } {
  if (!HABIT_SCHEDULE_TYPES.includes(input.scheduleType)) {
    throw new Error(`scheduleType must be one of: ${HABIT_SCHEDULE_TYPES.join(", ")}`);
  }
  if (input.scheduleType === "WEEKLY_DAYS") {
    const daysOfWeek = [...new Set(input.daysOfWeek)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    if (daysOfWeek.length === 0) throw new Error("Pick at least one day of the week");
    return { scheduleType: input.scheduleType, targetCount: 1, daysOfWeek };
  }
  if (!Number.isInteger(input.targetCount) || input.targetCount < 1) {
    throw new Error("targetCount must be a positive whole number");
  }
  return { scheduleType: input.scheduleType, targetCount: input.targetCount, daysOfWeek: [] };
}

export function createHabit(input: HabitScheduleInput & { title: string; durationMinutes?: number | null }) {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  const schedule = resolveHabitSchedule(input);

  return prisma.habit.create({
    data: { title, ...schedule, durationMinutes: input.durationMinutes ?? null },
  });
}

// UTC-midnight Date for a `YYYY-MM-DD` day-key (the HabitCompletion.date encoding).
function completionDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

// Marks a habit done for today (idempotent — a second call the same day is a no-op) and logs the
// completion to the Logbook. Today's calendar date is resolved in the configured timezone.
export async function completeHabit(id: string): Promise<Habit> {
  const habit = await prisma.habit.findUnique({ where: { id } });
  if (!habit) throw new Error("Habit not found");

  const { timeZone } = await getAppSettings();
  const date = completionDate(habitDateKey(new Date(), timeZone));
  const existing = await prisma.habitCompletion.findUnique({ where: { habitId_date: { habitId: id, date } } });
  if (!existing) {
    await prisma.habitCompletion.create({ data: { habitId: id, date } });
    await logCompletion("HABIT", habit.id, habit.title);
  }
  return habit;
}

// Heatmap edit: toggles a completion for an arbitrary calendar date (add if missing, remove if
// present). Retroactive edits don't touch the Logbook.
export async function toggleHabitCompletion(id: string, dateKey: string): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("Invalid date");
  const date = completionDate(dateKey);
  const existing = await prisma.habitCompletion.findUnique({ where: { habitId_date: { habitId: id, date } } });
  if (existing) {
    await prisma.habitCompletion.delete({ where: { id: existing.id } });
  } else {
    await prisma.habitCompletion.create({ data: { habitId: id, date } });
  }
}

export function updateHabit(
  id: string,
  input: { title?: string } & Partial<HabitScheduleInput> & { durationMinutes?: number | null }
) {
  const data: Prisma.HabitUpdateInput = { title: input.title, durationMinutes: input.durationMinutes };
  if (input.scheduleType !== undefined) {
    Object.assign(
      data,
      resolveHabitSchedule({
        scheduleType: input.scheduleType,
        targetCount: input.targetCount ?? 1,
        daysOfWeek: input.daysOfWeek ?? [],
      })
    );
  }

  return notFoundAsError("Habit not found", () => prisma.habit.update({ where: { id }, data }));
}

export async function deleteHabit(id: string) {
  const habit = await notFoundAsError("Habit not found", () => prisma.habit.delete({ where: { id } }));
  await deleteDayPlanBlocksFor("HABIT", id);
  return habit;
}

// Top-level routines only: sub-routines are fetched nested so a cluster (e.g. "Wake Up
// Routine" -> "Make coffee"/"Brush teeth"/"Shave") renders and notifies as one unit.
export const getRoutines = () =>
  prisma.routine.findMany({
    where: { parentId: null },
    include: { subroutines: { orderBy: { title: "asc" } } },
    orderBy: { reminderTime: "asc" },
  });

type RoutineRecurrenceInput = {
  frequency: RoutineFrequency;
  interval?: number;
  daysOfWeek?: number[];
  monthlyMode?: RoutineMonthlyMode;
  dayOfMonth?: number | null;
  monthlyOrdinal?: number | null;
  monthlyWeekday?: number | null;
};

// Resolves the recurrence fields that actually apply to `frequency`/`monthlyMode`, nulling out
// whichever ones don't (e.g. a WEEKLY routine has no monthly fields, a DATE-mode monthly routine
// has no monthlyOrdinal/monthlyWeekday) so stale values from a previous edit never linger.
function resolveRoutineRecurrence(input: RoutineRecurrenceInput) {
  if (!ROUTINE_FREQUENCIES.includes(input.frequency)) {
    throw new Error(`frequency must be one of: ${ROUTINE_FREQUENCIES.join(", ")}`);
  }
  const interval = input.interval && input.interval > 0 ? Math.floor(input.interval) : 1;
  const monthlyMode = input.monthlyMode ?? "DATE";

  return {
    frequency: input.frequency,
    interval,
    daysOfWeek: input.frequency === "WEEKLY" ? input.daysOfWeek ?? [] : [],
    monthlyMode,
    dayOfMonth: input.frequency === "MONTHLY" && monthlyMode === "DATE" ? input.dayOfMonth ?? null : null,
    monthlyOrdinal: input.frequency === "MONTHLY" && monthlyMode === "WEEKDAY" ? input.monthlyOrdinal ?? null : null,
    monthlyWeekday: input.frequency === "MONTHLY" && monthlyMode === "WEEKDAY" ? input.monthlyWeekday ?? null : null,
  };
}

export function createRoutine(input: { title: string; reminderTime: string; durationMinutes?: number | null } & RoutineRecurrenceInput) {
  const title = input.title.trim();
  const reminderTime = input.reminderTime.trim();
  if (!title || !reminderTime) throw new Error("Title and reminder time are required");

  return prisma.routine.create({
    data: { title, reminderTime, durationMinutes: input.durationMinutes ?? null, ...resolveRoutineRecurrence(input) },
  });
}

// A sub-routine has no schedule of its own — it just carries the parent's reminderTime/
// frequency along (unused directly, since only top-level routines are checked for due-today/
// notified) purely so the row satisfies the same required columns as any other Routine.
export async function createSubroutine(parentId: string, title: string) {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error("Title is required");

  return notFoundAsError("Routine not found", async () => {
    const parent = await prisma.routine.findUniqueOrThrow({ where: { id: parentId } });
    return prisma.routine.create({
      data: {
        title: trimmedTitle,
        reminderTime: parent.reminderTime,
        frequency: parent.frequency,
        interval: parent.interval,
        daysOfWeek: parent.daysOfWeek,
        monthlyMode: parent.monthlyMode,
        dayOfMonth: parent.dayOfMonth,
        monthlyOrdinal: parent.monthlyOrdinal,
        monthlyWeekday: parent.monthlyWeekday,
        parentId,
      },
    });
  });
}

export function updateRoutine(
  id: string,
  input: Partial<{ title: string; reminderTime: string; isActive: boolean; pausedUntil: string | null; durationMinutes: number | null } & RoutineRecurrenceInput>
) {
  const recurrence = input.frequency === undefined ? undefined : resolveRoutineRecurrence(input as RoutineRecurrenceInput);

  return notFoundAsError("Routine not found", () =>
    prisma.routine.update({
      where: { id },
      data: {
        title: input.title,
        reminderTime: input.reminderTime,
        isActive: input.isActive,
        pausedUntil: input.pausedUntil === undefined ? undefined : input.pausedUntil ? new Date(input.pausedUntil) : null,
        durationMinutes: input.durationMinutes,
        ...recurrence,
      },
    })
  );
}

// Ticks a whole cluster "done" now — the routine passed in (parent or, defensively, a child)
// plus every sibling under the same parent, so "Wake Up Routine" and its sub-routines
// complete together in one action. The tick is transient: isRoutineTickedNow() below reports
// it as unticked again after ROUTINE_TICK_EXPIRY_MS, ready for its next scheduled occurrence.
// Also stamps notifiedAt so the cron won't re-notify for the same day's occurrence.
export function completeRoutineCluster(id: string, auto = false) {
  return notFoundAsError("Routine not found", async () => {
    const routine = await prisma.routine.findUniqueOrThrow({ where: { id } });
    const rootId = routine.parentId ?? routine.id;
    const root = routine.parentId ? await prisma.routine.findUniqueOrThrow({ where: { id: rootId } }) : routine;
    const now = new Date();
    await prisma.routine.updateMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }] },
      data: { lastCompletedAt: now, notifiedAt: now },
    });
    // One history row per cluster tick; auto=true means the notification cron ticked it.
    await logCompletion("ROUTINE", rootId, root.title, auto);
    return routine;
  });
}

// Reinstates a routine cluster the cron auto-ticked but the user didn't actually do ("Not
// done" action button on the notification). Keeps notifiedAt so it won't re-notify today.
export function untickRoutineCluster(id: string) {
  return notFoundAsError("Routine not found", async () => {
    const routine = await prisma.routine.findUniqueOrThrow({ where: { id } });
    const rootId = routine.parentId ?? routine.id;
    await prisma.routine.updateMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }] },
      data: { lastCompletedAt: null },
    });
    await retractLatestCompletion("ROUTINE", rootId);
    return routine;
  });
}

export function isRoutineTickedNow(routine: Pick<Routine, "lastCompletedAt">): boolean {
  if (!routine.lastCompletedAt) return false;
  return Date.now() - routine.lastCompletedAt.getTime() < ROUTINE_TICK_EXPIRY_MS;
}

// Deleting a parent cascades to its sub-routines (see schema's onDelete: Cascade); deleting a
// child just removes that one row.
export async function deleteRoutine(id: string) {
  const routine = await notFoundAsError("Routine not found", () => prisma.routine.delete({ where: { id } }));
  await deleteDayPlanBlocksFor("ROUTINE", id);
  return routine;
}

const DEFAULT_CATEGORIES = ["Work", "Home"];

// Selectable options for the task category dropdown. Seeds a couple of defaults the first
// time it's called on an empty table so the dropdown is never empty out of the box.
export async function getCategories() {
  const existing = await prisma.category.findMany({ orderBy: { name: "asc" } });
  if (existing.length > 0) return existing;
  await prisma.category.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ name })), skipDuplicates: true });
  return prisma.category.findMany({ orderBy: { name: "asc" } });
}

export function createCategory(name: string, scope: CategoryScope = "NONE") {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  if (!CATEGORY_SCOPES.includes(scope)) throw new Error(`scope must be one of: ${CATEGORY_SCOPES.join(", ")}`);
  return prisma.category.create({ data: { name: trimmed, scope } });
}

// Which mode (work/home/both) this category's tasks show under — see schema comment.
export function updateCategoryScope(id: string, scope: CategoryScope) {
  if (!CATEGORY_SCOPES.includes(scope)) throw new Error(`scope must be one of: ${CATEGORY_SCOPES.join(", ")}`);
  return notFoundAsError("Category not found", () => prisma.category.update({ where: { id }, data: { scope } }));
}

// Task.category is a free-text mirror of the category name rather than a foreign key (see
// schema comment), so renaming a category has to also rewrite every Task row that referenced
// the old name — otherwise those tasks would silently point at a name nothing selects anymore.
export async function updateCategory(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  return notFoundAsError("Category not found", async () => {
    const existing = await prisma.category.findUniqueOrThrow({ where: { id } });
    const [category] = await prisma.$transaction([
      prisma.category.update({ where: { id }, data: { name: trimmed } }),
      prisma.task.updateMany({ where: { category: existing.name }, data: { category: trimmed } }),
    ]);
    return category;
  });
}

export async function deleteCategory(id: string) {
  const count = await prisma.category.count();
  if (count <= 1) throw new Error("At least one category must remain");
  return notFoundAsError("Category not found", () => prisma.category.delete({ where: { id } }));
}

// --- App settings (single-user, single row) ---

const APP_SETTINGS_ID = "app";

// Lazily creates the singleton row on first read. Deliberately NOT an upsert: this runs on
// every page load (and every focus-triggered refresh), so the common path must be a pure read.
export async function getAppSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: APP_SETTINGS_ID } });
  if (existing) return existing;
  return prisma.appSettings.upsert({
    where: { id: APP_SETTINGS_ID },
    update: {},
    create: { id: APP_SETTINGS_ID, timeZone: DEFAULT_TIME_ZONE },
  });
}

// Heartbeat stamp for the notification cron — the UI warns when this goes stale (i.e. the
// external scheduler has stopped calling /api/cron/check-due).
export function markCronRun(at: Date) {
  return prisma.appSettings.upsert({
    where: { id: APP_SETTINGS_ID },
    update: { lastCronAt: at },
    create: { id: APP_SETTINGS_ID, timeZone: DEFAULT_TIME_ZONE, lastCronAt: at },
  });
}

export function updateTimeZone(timeZone: string) {
  if (!SUPPORTED_TIME_ZONES.some((z) => z.id === timeZone)) {
    throw new Error(`timeZone must be one of: ${SUPPORTED_TIME_ZONES.map((z) => z.id).join(", ")}`);
  }
  return prisma.appSettings.upsert({
    where: { id: APP_SETTINGS_ID },
    update: { timeZone },
    create: { id: APP_SETTINGS_ID, timeZone },
  });
}

// --- Dismissed calendar (ICS) events ---

// Ids embed the event's start date (see calendar.ts's CalendarEvent.id), so anything older than
// this is for an event long past — opportunistically swept on read to keep the table bounded.
const DISMISSED_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export async function getDismissedCalendarEventIds(): Promise<string[]> {
  const rows = await prisma.dismissedCalendarEvent.findMany({ select: { eventId: true } });
  return rows.map((r) => r.eventId);
}

// Retention sweep — called from the notification cron rather than on the page-load read path
// (it used to run a deleteMany on every page render).
export function sweepDismissedCalendarEvents() {
  return prisma.dismissedCalendarEvent.deleteMany({
    where: { dismissedAt: { lt: new Date(Date.now() - DISMISSED_EVENT_RETENTION_MS) } },
  });
}

// Double-dismissing (e.g. an optimistic retry) is harmless, hence upsert-as-create-or-noop.
export function dismissCalendarEvent(eventId: string) {
  return prisma.dismissedCalendarEvent.upsert({
    where: { eventId },
    update: {},
    create: { eventId },
  });
}

// deleteMany (rather than delete) so restoring an already-restored/never-dismissed event is a
// harmless no-op instead of throwing on a missing row.
export function restoreCalendarEvent(eventId: string) {
  return prisma.dismissedCalendarEvent.deleteMany({ where: { eventId } });
}

// --- My Day plan blocks ---

// Blocks reference their entity loosely (entityId spans four tables), so a block can outlive
// its entity — the deriver skips unresolved ones, delete paths below clear their own, and the
// cron sweep bounds the rest.

const DAY_PLAN_LOOKBACK_MS = 7 * MS_PER_DAY;

// Recent past (so yesterday's plan is still inspectable) plus everything scheduled ahead.
export function getDayPlanBlocks() {
  return prisma.dayPlanBlock.findMany({
    where: { date: { gte: new Date(Date.now() - DAY_PLAN_LOOKBACK_MS) } },
    orderBy: { createdAt: "asc" },
  });
}

// Upsert on the (date, entityType, entityId) unique triple: "do today" clicks and replayed
// offline creates stay idempotent — a re-place updates the time/duration instead of throwing.
export function createDayPlanBlock(input: {
  date: string; // "YYYY-MM-DD"
  entityType: CapturedKind;
  entityId: string;
  startTime?: string | null;
  durationMinutes?: number | null;
  sortOrder?: number | null;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid date");
  const date = combineDueDateTime(input.date);
  return prisma.dayPlanBlock.upsert({
    where: { date_entityType_entityId: { date, entityType: input.entityType, entityId: input.entityId } },
    update: {
      startTime: input.startTime ?? null,
      durationMinutes: input.durationMinutes ?? undefined,
      sortOrder: input.sortOrder ?? undefined,
    },
    create: {
      date,
      entityType: input.entityType,
      entityId: input.entityId,
      startTime: input.startTime ?? null,
      durationMinutes: input.durationMinutes ?? null,
      sortOrder: input.sortOrder ?? null,
    },
  });
}

export function updateDayPlanBlock(
  id: string,
  input: Partial<{ date: string; startTime: string | null; durationMinutes: number | null; sortOrder: number | null }>
) {
  if (input.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid date");
  return notFoundAsError("Plan block not found", () =>
    prisma.dayPlanBlock.update({
      where: { id },
      data: {
        date: input.date === undefined ? undefined : combineDueDateTime(input.date),
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        sortOrder: input.sortOrder,
      },
    })
  );
}

export function deleteDayPlanBlock(id: string) {
  // deleteMany so a double-delete (optimistic retry) is a no-op rather than a thrown P2025.
  return prisma.dayPlanBlock.deleteMany({ where: { id } });
}

// Clears every placement of an entity — called from the entity delete paths.
function deleteDayPlanBlocksFor(entityType: CapturedKind, entityId: string) {
  return prisma.dayPlanBlock.deleteMany({ where: { entityType, entityId } });
}

// Retention sweep for stale blocks (older than the fetch window), called from the cron
// alongside sweepDismissedCalendarEvents — keeps the table bounded without a read-path cost.
export function sweepDayPlanBlocks() {
  return prisma.dayPlanBlock.deleteMany({
    where: { date: { lt: new Date(Date.now() - DAY_PLAN_LOOKBACK_MS) } },
  });
}

// --- AI planner suggestions + notes (My Day) ---

// PENDING suggestions surface in My Day; responded rows are kept forever as the feedback log
// (their dedupeKey also permanently suppresses regeneration — see schema comment).
export function getActiveSuggestions() {
  return prisma.aiSuggestion.findMany({
    where: { status: "PENDING" },
    orderBy: [{ suggestedDate: "asc" }, { createdAt: "asc" }],
  });
}

export async function getAllSuggestionDedupeKeys(): Promise<Set<string>> {
  const rows = await prisma.aiSuggestion.findMany({ select: { dedupeKey: true } });
  return new Set(rows.map((r) => r.dedupeKey));
}

export function createSuggestions(
  rows: {
    dedupeKey: string;
    kind: string;
    title: string;
    description?: string | null;
    eventId?: string | null;
    eventTitle?: string | null;
    suggestedDate?: string | null; // "YYYY-MM-DD"
  }[]
) {
  return prisma.aiSuggestion.createMany({
    data: rows.map((r) => ({
      dedupeKey: r.dedupeKey,
      kind: r.kind,
      title: r.title,
      description: r.description ?? null,
      eventId: r.eventId ?? null,
      eventTitle: r.eventTitle ?? null,
      suggestedDate: r.suggestedDate ? combineDueDateTime(r.suggestedDate) : null,
    })),
    skipDuplicates: true,
  });
}

// Snoozed suggestions come back when their date arrives — run at the start of generation.
export function wakeDueSnoozedSuggestions(now: Date) {
  return prisma.aiSuggestion.updateMany({
    where: { status: "SNOOZED", snoozedUntil: { lte: now } },
    data: { status: "PENDING", snoozedUntil: null },
  });
}

// Feedback context for the generation prompt: how each suggestion kind has fared recently
// (accept/snooze/dismiss counts) plus a handful of concrete recent examples.
export async function getSuggestionFeedback(sinceDays = 90) {
  const since = new Date(Date.now() - sinceDays * MS_PER_DAY);
  const [stats, recent] = await Promise.all([
    prisma.aiSuggestion.groupBy({
      by: ["kind", "status"],
      where: { respondedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.aiSuggestion.findMany({
      where: { respondedAt: { not: null } },
      orderBy: { respondedAt: "desc" },
      take: 10,
      select: { kind: true, title: true, eventTitle: true, status: true },
    }),
  ]);
  return {
    stats: stats.map((s) => ({ kind: s.kind, status: s.status, count: s._count._all })),
    recent,
  };
}

// Accept: create the real task and mark the suggestion in one transaction.
export async function acceptSuggestion(id: string, input: { category: string; dueDate?: string | null }) {
  return notFoundAsError("Suggestion not found", async () => {
    const suggestion = await prisma.aiSuggestion.findUniqueOrThrow({ where: { id } });
    const task = await createTask({
      title: suggestion.title,
      category: input.category,
      description: suggestion.description,
      dueDate:
        input.dueDate !== undefined
          ? input.dueDate
          : suggestion.suggestedDate
            ? new Date(suggestion.suggestedDate).toISOString().slice(0, 10)
            : null,
    });
    await prisma.aiSuggestion.update({
      where: { id },
      data: { status: "ACCEPTED", createdTaskId: task.id, respondedAt: new Date() },
    });
    return task;
  });
}

export function respondToSuggestion(id: string, status: "SNOOZED" | "DISMISSED", snoozedUntil?: string | null) {
  return notFoundAsError("Suggestion not found", () =>
    prisma.aiSuggestion.update({
      where: { id },
      data: {
        status,
        snoozedUntil: status === "SNOOZED" && snoozedUntil ? combineDueDateTime(snoozedUntil) : null,
        respondedAt: new Date(),
      },
    })
  );
}

export const getAiNotes = () => prisma.aiNote.findMany({ orderBy: { createdAt: "asc" } });

export function createAiNote(content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Note is required");
  return prisma.aiNote.create({ data: { content: trimmed } });
}

export function deleteAiNote(id: string) {
  return prisma.aiNote.deleteMany({ where: { id } });
}

// First-run seeding: the user's stated workflow rules become the initial editable notes.
export async function seedAiNotesIfEmpty(defaults: string[]) {
  const count = await prisma.aiNote.count();
  if (count > 0) return;
  await prisma.aiNote.createMany({ data: defaults.map((content) => ({ content })) });
}

// Blocked tasks for the generation prompt — the AI nudges when a block is due to clear or a
// deadline is looming behind one.
export async function getBlockedTasks() {
  const rows = await prisma.task.findMany({
    where: { isCompleted: false, blockedReason: { not: null } },
    select: {
      title: true,
      blockedReason: true,
      blockedUntil: true,
      dueDate: true,
      project: { select: { name: true, dueDate: true } },
    },
  });
  return rows.map((r) => ({
    title: r.title,
    reason: r.blockedReason ?? "",
    blockedUntil: r.blockedUntil ? new Date(r.blockedUntil).toISOString().slice(0, 10) : null,
    dueDate: r.dueDate ? new Date(r.dueDate).toISOString().slice(0, 10) : null,
    projectName: r.project?.name ?? null,
    projectDueDate: r.project?.dueDate ? new Date(r.project.dueDate).toISOString().slice(0, 10) : null,
  }));
}

// Open task titles for the generation prompt's duplicate-avoidance list.
export async function getOpenTaskTitles(limit = 200): Promise<string[]> {
  const rows = await prisma.task.findMany({
    where: { isCompleted: false },
    select: { title: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => r.title);
}

// Every row is an unread notice pointing at a Task/Project/Routine/Habit that voice capture
// already created — the notification panel's job is just to surface it for a quick look.
export const getUnreadVoiceCaptures = () => prisma.voiceCapture.findMany({ orderBy: { createdAt: "desc" } });

export function createVoiceCaptureNotice(input: {
  transcript: string;
  kind: CapturedKind;
  entityId: string;
  summary: string;
  parseError: boolean;
  source?: CaptureSource;
}) {
  return prisma.voiceCapture.create({ data: input });
}

// Used for both "mark as read" and "edit" — either way, the notice has been seen.
export function dismissVoiceCapture(id: string) {
  return notFoundAsError("Notification not found", () => prisma.voiceCapture.delete({ where: { id } }));
}

// --- Push notifications ---

export const getPushSubscriptions = () => prisma.pushSubscription.findMany();

// Re-subscribing the same device (e.g. after reinstalling the PWA) reuses its endpoint, so
// this is an upsert rather than a plain create.
export function savePushSubscription(input: { endpoint: string; p256dh: string; auth: string }) {
  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: input,
    update: { p256dh: input.p256dh, auth: input.auth },
  });
}

export function deletePushSubscription(endpoint: string) {
  return prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

// Tasks/projects that *might* be due for a notification, for the due-date notification cron.
// `until` should be `now + getTimeZoneOffsetMs(now, timeZone)` (see taskbookDates.ts's
// dueInstant/getTimeZoneOffsetMs) since stored due dates with an explicit time are face-value
// clock times in the configured zone, up to that offset ahead of the real UTC instant — this
// over-fetches a bit so the caller's precise `dueInstant(due, timeZone) <= now` check never
// misses a timed item. notifiedAt is cleared whenever dueDate is edited (see
// updateTask/updateProject) so a rescheduled item can notify again at its new time.
export function getUnnotifiedDueTasks(until: Date) {
  return prisma.task.findMany({ where: { dueDate: { lte: until }, isCompleted: false, notifiedAt: null } });
}

export function getUnnotifiedDueProjects(until: Date) {
  return prisma.project.findMany({ where: { dueDate: { lte: until }, isCompleted: false, notifiedAt: null } });
}

// Every active top-level routine cluster, for the routine notification cron — includes
// sub-routines so a cluster's push body can list them (e.g. "Make coffee · Brush teeth · Shave").
export function getActiveTopLevelRoutines() {
  return prisma.routine.findMany({
    where: { parentId: null, isActive: true },
    include: { subroutines: true },
  });
}

export function markRoutineNotified(id: string, at: Date) {
  return prisma.routine.update({ where: { id }, data: { notifiedAt: at } });
}

export function markTaskNotified(id: string, at: Date) {
  return prisma.task.update({ where: { id }, data: { notifiedAt: at } });
}

export function markProjectNotified(id: string, at: Date) {
  return prisma.project.update({ where: { id }, data: { notifiedAt: at } });
}
