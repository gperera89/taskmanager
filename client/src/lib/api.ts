import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextOccurrence, resolveTaskRepeat, type TaskRepeatRule } from "@/lib/taskRecurrence";
import { DEFAULT_TIME_ZONE, SUPPORTED_TIME_ZONES } from "@/lib/taskbookDates";

export type { Task, Project, Habit, Routine, Category, HabitIntervalUnit, RoutineFrequency, RoutineMonthlyMode, CapturedKind } from "@prisma/client";
import type { CapturedKind, Habit, HabitIntervalUnit, Routine, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";

const HABIT_INTERVAL_UNITS: HabitIntervalUnit[] = ["DAY", "WEEK", "MONTH"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];
// Approximate window length used to judge whether a completion keeps the streak alive. Months
// aren't calendar-aware — a 30-day window is close enough for streak bucketing purposes.
const INTERVAL_UNIT_DAYS: Record<HabitIntervalUnit, number> = { DAY: 1, WEEK: 7, MONTH: 30 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const ROUTINE_TICK_EXPIRY_MS = 60 * 60 * 1000;

function habitWindowDays(habit: Pick<Habit, "intervalValue" | "intervalUnit">): number {
  return habit.intervalValue * INTERVAL_UNIT_DAYS[habit.intervalUnit];
}

// Periods are windowDays-long buckets since the epoch; completions in the same bucket as
// the last one are a no-op, the next bucket extends the streak, anything later resets it.
function habitPeriodIndex(date: Date, windowDays: number) {
  return Math.floor(date.getTime() / (MS_PER_DAY * windowDays));
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
// into its own children without a second round trip.
export const getTasks = () =>
  prisma.task.findMany({
    where: { parentId: null },
    include: { subtasks: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

// Due dates are stored as UTC midnight of the chosen calendar date (see taskbookDates.ts),
// with a clock time layered on top at face value — not a real timezone conversion, just the
// literal HH:MM the user picked, anchored to UTC so the calendar-day math never rolls over.
function combineDueDateTime(dueDate: string, dueTime?: string | null): Date {
  const time = dueTime && /^\d{2}:\d{2}$/.test(dueTime) ? dueTime : "00:00";
  return new Date(`${dueDate}T${time}:00.000Z`);
}

export type TaskRepeatInput = {
  frequency: RoutineFrequency;
  interval?: number;
  daysOfWeek?: number[];
  monthlyMode?: RoutineMonthlyMode;
  dayOfMonth?: number | null;
  monthlyOrdinal?: number | null;
  monthlyWeekday?: number | null;
};

// The Prisma shape for "this task doesn't repeat" — every repeat field cleared.
const NO_REPEAT = {
  repeatFrequency: null,
  repeatInterval: null,
  repeatDaysOfWeek: [] as number[],
  repeatMonthlyMode: null,
  repeatDayOfMonth: null,
  repeatMonthlyOrdinal: null,
  repeatMonthlyWeekday: null,
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
        ...(input.repeat === undefined ? {} : repeatToPrismaData(input.repeat)),
      },
    })
  );
}

export function deleteTask(id: string) {
  // Subtasks cascade-delete with their parent (see schema: parent relation onDelete: Cascade).
  return notFoundAsError("Task not found", () => prisma.task.delete({ where: { id } }));
}

// Completing a repeating task rolls its due date forward to the next occurrence in place
// (isCompleted stays false) rather than marking it done — mirrors how Routines tick and
// reset instead of leaving a trail of completed rows. Non-repeating tasks just toggle normally.
export async function toggleTaskCompletion(id: string, isCompleted: boolean) {
  if (isCompleted) return updateTask(id, { isCompleted: false });

  return notFoundAsError("Task not found", async () => {
    const task = await prisma.task.findUniqueOrThrow({ where: { id } });
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
    return prisma.task.update({ where: { id }, data: { isCompleted: true } });
  });
}

export const getProjects = () => prisma.project.findMany();

export function createProject(input: { name: string; description?: string | null; dueDate?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");

  return prisma.project.create({
    data: {
      name,
      description: input.description,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
    },
  });
}

export function updateProject(
  id: string,
  input: Partial<{ name: string; description: string | null; isCompleted: boolean; dueDate: string | null }>
) {
  return notFoundAsError("Project not found", () =>
    prisma.project.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        isCompleted: input.isCompleted,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
        // A changed due date is a new deadline to notify about.
        notifiedAt: input.dueDate === undefined ? undefined : null,
      },
    })
  );
}

export function deleteProject(id: string) {
  return notFoundAsError("Project not found", () => prisma.project.delete({ where: { id } }));
}

export const getHabits = () => prisma.habit.findMany();

export function createHabit(input: { title: string; intervalValue: number; intervalUnit: HabitIntervalUnit }) {
  const title = input.title.trim();
  if (!title) throw new Error("Title is required");
  if (!HABIT_INTERVAL_UNITS.includes(input.intervalUnit)) {
    throw new Error(`intervalUnit must be one of: ${HABIT_INTERVAL_UNITS.join(", ")}`);
  }
  if (!Number.isInteger(input.intervalValue) || input.intervalValue < 1) {
    throw new Error("intervalValue must be a positive whole number");
  }

  return prisma.habit.create({
    data: { title, intervalValue: input.intervalValue, intervalUnit: input.intervalUnit },
  });
}

// Marks a habit done "now" and recomputes its streak based on its frequency window.
export async function completeHabit(id: string): Promise<Habit> {
  const habit = await prisma.habit.findUnique({ where: { id } });
  if (!habit) throw new Error("Habit not found");

  const windowDays = habitWindowDays(habit);
  const now = new Date();
  const nowPeriod = habitPeriodIndex(now, windowDays);

  let currentStreak = habit.currentStreak;
  if (!habit.lastCompletedDate) {
    currentStreak = 1;
  } else {
    const lastPeriod = habitPeriodIndex(habit.lastCompletedDate, windowDays);
    if (nowPeriod === lastPeriod) {
      return habit; // Already marked done for the current period.
    }
    currentStreak = nowPeriod === lastPeriod + 1 ? currentStreak + 1 : 1;
  }

  return prisma.habit.update({
    where: { id },
    data: {
      currentStreak,
      longestStreak: Math.max(habit.longestStreak, currentStreak),
      lastCompletedDate: now,
    },
  });
}

export function updateHabit(
  id: string,
  input: Partial<{ title: string; intervalValue: number; intervalUnit: HabitIntervalUnit }>
) {
  if (input.intervalUnit !== undefined && !HABIT_INTERVAL_UNITS.includes(input.intervalUnit)) {
    throw new Error(`intervalUnit must be one of: ${HABIT_INTERVAL_UNITS.join(", ")}`);
  }
  if (input.intervalValue !== undefined && (!Number.isInteger(input.intervalValue) || input.intervalValue < 1)) {
    throw new Error("intervalValue must be a positive whole number");
  }

  return notFoundAsError("Habit not found", () =>
    prisma.habit.update({
      where: { id },
      data: { title: input.title, intervalValue: input.intervalValue, intervalUnit: input.intervalUnit },
    })
  );
}

export function deleteHabit(id: string) {
  return notFoundAsError("Habit not found", () => prisma.habit.delete({ where: { id } }));
}

export type HabitStatus = {
  habit: Habit;
  periodEndsAt: Date;
  daysRemaining: number;
  isDoneThisPeriod: boolean;
  atRisk: boolean;
};

// Ranks habits by urgency: whichever is closest to breaking its streak comes first. When
// nothing is at risk, the front of this same list is the best "what should I do" suggestion.
export async function getHabitsWithStatus(): Promise<HabitStatus[]> {
  const habits = await prisma.habit.findMany();
  const now = new Date();

  return habits
    .map((habit) => {
      const windowDays = habitWindowDays(habit);
      const nowPeriod = habitPeriodIndex(now, windowDays);
      const periodEndsAt = new Date((nowPeriod + 1) * windowDays * MS_PER_DAY);
      const isDoneThisPeriod =
        habit.lastCompletedDate != null && habitPeriodIndex(habit.lastCompletedDate, windowDays) === nowPeriod;
      const daysRemaining = (periodEndsAt.getTime() - now.getTime()) / MS_PER_DAY;

      return {
        habit,
        periodEndsAt,
        daysRemaining,
        isDoneThisPeriod,
        atRisk: !isDoneThisPeriod && daysRemaining <= 1,
      };
    })
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
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

export function createRoutine(input: { title: string; reminderTime: string } & RoutineRecurrenceInput) {
  const title = input.title.trim();
  const reminderTime = input.reminderTime.trim();
  if (!title || !reminderTime) throw new Error("Title and reminder time are required");

  return prisma.routine.create({
    data: { title, reminderTime, ...resolveRoutineRecurrence(input) },
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
  input: Partial<{ title: string; reminderTime: string; isActive: boolean; pausedUntil: string | null } & RoutineRecurrenceInput>
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
export function completeRoutineCluster(id: string) {
  return notFoundAsError("Routine not found", async () => {
    const routine = await prisma.routine.findUniqueOrThrow({ where: { id } });
    const rootId = routine.parentId ?? routine.id;
    const now = new Date();
    await prisma.routine.updateMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }] },
      data: { lastCompletedAt: now, notifiedAt: now },
    });
    return routine;
  });
}

export function isRoutineTickedNow(routine: Pick<Routine, "lastCompletedAt">): boolean {
  if (!routine.lastCompletedAt) return false;
  return Date.now() - routine.lastCompletedAt.getTime() < ROUTINE_TICK_EXPIRY_MS;
}

// Deleting a parent cascades to its sub-routines (see schema's onDelete: Cascade); deleting a
// child just removes that one row.
export function deleteRoutine(id: string) {
  return notFoundAsError("Routine not found", () => prisma.routine.delete({ where: { id } }));
}

const DEFAULT_CATEGORIES = ["Work", "Personal"];

// Selectable options for the task category dropdown. Seeds a couple of defaults the first
// time it's called on an empty table so the dropdown is never empty out of the box.
export async function getCategories() {
  const existing = await prisma.category.findMany({ orderBy: { name: "asc" } });
  if (existing.length > 0) return existing;
  await prisma.category.createMany({ data: DEFAULT_CATEGORIES.map((name) => ({ name })), skipDuplicates: true });
  return prisma.category.findMany({ orderBy: { name: "asc" } });
}

export function createCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  return prisma.category.create({ data: { name: trimmed } });
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

// Lazily creates the singleton row on first read, mirroring getCategories' seed-if-empty pattern.
export async function getAppSettings() {
  return prisma.appSettings.upsert({
    where: { id: APP_SETTINGS_ID },
    update: {},
    create: { id: APP_SETTINGS_ID, timeZone: DEFAULT_TIME_ZONE },
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
  await prisma.dismissedCalendarEvent.deleteMany({
    where: { dismissedAt: { lt: new Date(Date.now() - DISMISSED_EVENT_RETENTION_MS) } },
  });
  const rows = await prisma.dismissedCalendarEvent.findMany({ select: { eventId: true } });
  return rows.map((r) => r.eventId);
}

// Double-dismissing (e.g. an optimistic retry) is harmless, hence upsert-as-create-or-noop.
export function dismissCalendarEvent(eventId: string) {
  return prisma.dismissedCalendarEvent.upsert({
    where: { eventId },
    update: {},
    create: { eventId },
  });
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
