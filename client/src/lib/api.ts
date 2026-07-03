import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type { Task, Project, Habit, Routine, Category, HabitFrequency, RoutineFrequency, CapturedKind } from "@prisma/client";
import type { CapturedKind, Habit, HabitFrequency, Routine, RoutineFrequency } from "@prisma/client";

const HABIT_FREQUENCIES: HabitFrequency[] = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];
// Approximate window length used to judge whether a completion keeps the streak alive.
// CUSTOM has no fixed window: it's read from the habit's own customIntervalDays instead.
const HABIT_WINDOW_DAYS: Record<Exclude<HabitFrequency, "CUSTOM">, number> = {
  DAILY: 1,
  WEEKLY: 7,
  FORTNIGHTLY: 14,
  MONTHLY: 30,
};
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ROUTINE_TICK_EXPIRY_MS = 60 * 60 * 1000;

function habitWindowDays(habit: Pick<Habit, "frequency" | "customIntervalDays">): number {
  if (habit.frequency === "CUSTOM") return habit.customIntervalDays ?? 1;
  return HABIT_WINDOW_DAYS[habit.frequency];
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

export function createTask(input: {
  title: string;
  category: string;
  description?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
  parentId?: string | null;
}) {
  const title = input.title.trim();
  const category = input.category.trim();
  if (!title || !category) throw new Error("Title and category are required");

  return prisma.task.create({
    data: {
      title,
      category,
      description: input.description || null,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      projectId: input.projectId || null,
      parentId: input.parentId || null,
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
    isCompleted: boolean;
    projectId: string | null;
    parentId: string | null;
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
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
        isCompleted: input.isCompleted,
        projectId: input.projectId === undefined ? undefined : input.projectId || null,
        parentId: input.parentId === undefined ? undefined : input.parentId || null,
      },
    })
  );
}

export function deleteTask(id: string) {
  // Subtasks cascade-delete with their parent (see schema: parent relation onDelete: Cascade).
  return notFoundAsError("Task not found", () => prisma.task.delete({ where: { id } }));
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
      },
    })
  );
}

export function deleteProject(id: string) {
  return notFoundAsError("Project not found", () => prisma.project.delete({ where: { id } }));
}

// Tasks and projects due within [from, to], for the calendar's day-detail view.
export async function getDueItems(from: Date, to: Date) {
  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({ where: { dueDate: { gte: from, lte: to } }, include: { project: true } }),
    prisma.project.findMany({ where: { dueDate: { gte: from, lte: to } } }),
  ]);
  return { tasks, projects };
}

export const getHabits = () => prisma.habit.findMany();

export function createHabit(input: { title: string; frequency: HabitFrequency; customIntervalDays?: number | null }) {
  const title = input.title.trim();
  if (!title || !HABIT_FREQUENCIES.includes(input.frequency)) {
    throw new Error("Title and a valid frequency are required");
  }
  if (input.frequency === "CUSTOM" && (!input.customIntervalDays || input.customIntervalDays < 1)) {
    throw new Error("customIntervalDays must be a positive number when frequency is CUSTOM");
  }

  return prisma.habit.create({
    data: {
      title,
      frequency: input.frequency,
      customIntervalDays: input.frequency === "CUSTOM" ? input.customIntervalDays : null,
    },
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
  input: Partial<{ title: string; frequency: HabitFrequency; customIntervalDays: number | null }>
) {
  if (input.frequency !== undefined && !HABIT_FREQUENCIES.includes(input.frequency)) {
    throw new Error(`frequency must be one of: ${HABIT_FREQUENCIES.join(", ")}`);
  }
  if (input.frequency === "CUSTOM" && (!input.customIntervalDays || input.customIntervalDays < 1)) {
    throw new Error("customIntervalDays must be a positive number when frequency is CUSTOM");
  }

  return notFoundAsError("Habit not found", () =>
    prisma.habit.update({
      where: { id },
      data: {
        title: input.title,
        frequency: input.frequency,
        customIntervalDays:
          input.frequency === undefined ? undefined : input.frequency === "CUSTOM" ? input.customIntervalDays : null,
      },
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

export const getRoutines = () => prisma.routine.findMany();

export function createRoutine(input: {
  title: string;
  reminderTime: string;
  frequency: RoutineFrequency;
  daysOfWeek?: number[];
  dayOfMonth?: number | null;
}) {
  const title = input.title.trim();
  const reminderTime = input.reminderTime.trim();
  if (!title || !reminderTime) throw new Error("Title and reminder time are required");
  if (!ROUTINE_FREQUENCIES.includes(input.frequency)) {
    throw new Error(`frequency must be one of: ${ROUTINE_FREQUENCIES.join(", ")}`);
  }

  return prisma.routine.create({
    data: {
      title,
      reminderTime,
      frequency: input.frequency,
      daysOfWeek: input.frequency === "WEEKLY" ? input.daysOfWeek ?? [] : [],
      dayOfMonth: input.frequency === "MONTHLY" ? input.dayOfMonth ?? null : null,
    },
  });
}

export function updateRoutine(
  id: string,
  input: Partial<{
    title: string;
    reminderTime: string;
    isActive: boolean;
    frequency: RoutineFrequency;
    daysOfWeek: number[];
    dayOfMonth: number | null;
  }>
) {
  if (input.frequency !== undefined && !ROUTINE_FREQUENCIES.includes(input.frequency)) {
    throw new Error(`frequency must be one of: ${ROUTINE_FREQUENCIES.join(", ")}`);
  }

  return notFoundAsError("Routine not found", () =>
    prisma.routine.update({
      where: { id },
      data: {
        title: input.title,
        reminderTime: input.reminderTime,
        isActive: input.isActive,
        frequency: input.frequency,
        daysOfWeek: input.daysOfWeek,
        dayOfMonth: input.dayOfMonth,
      },
    })
  );
}

// Ticks a routine "done" now. The tick is transient: isRoutineTickedNow() below reports it as
// unticked again after ROUTINE_TICK_EXPIRY_MS, ready for its next scheduled occurrence.
export function completeRoutine(id: string) {
  return notFoundAsError("Routine not found", () =>
    prisma.routine.update({ where: { id }, data: { lastCompletedAt: new Date() } })
  );
}

export function isRoutineTickedNow(routine: Pick<Routine, "lastCompletedAt">): boolean {
  if (!routine.lastCompletedAt) return false;
  return Date.now() - routine.lastCompletedAt.getTime() < ROUTINE_TICK_EXPIRY_MS;
}

export function deleteRoutine(id: string) {
  return notFoundAsError("Routine not found", () => prisma.routine.delete({ where: { id } }));
}

const DEFAULT_CATEGORIES = ["Home", "Personal"];

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

export async function deleteCategory(id: string) {
  const count = await prisma.category.count();
  if (count <= 1) throw new Error("At least one category must remain");
  return notFoundAsError("Category not found", () => prisma.category.delete({ where: { id } }));
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
