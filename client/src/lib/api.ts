import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type { Task, Project, Habit, Routine, HabitFrequency } from "@prisma/client";
import type { Habit, HabitFrequency } from "@prisma/client";

const HABIT_FREQUENCIES: HabitFrequency[] = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY"];
// Approximate window length used to judge whether a completion keeps the streak alive.
const HABIT_WINDOW_DAYS: Record<HabitFrequency, number> = { DAILY: 1, WEEKLY: 7, FORTNIGHTLY: 14, MONTHLY: 30 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export const getTasks = () => prisma.task.findMany();

export function createTask(input: { title: string; category: string; dueDate?: string | null }) {
  const title = input.title.trim();
  const category = input.category.trim();
  if (!title || !category) throw new Error("Title and category are required");

  return prisma.task.create({
    data: { title, category, dueDate: input.dueDate ? new Date(input.dueDate) : null },
  });
}

export function updateTask(
  id: string,
  input: Partial<{ title: string; category: string; dueDate: string | null; isCompleted: boolean }>
) {
  return notFoundAsError("Task not found", () =>
    prisma.task.update({
      where: { id },
      data: {
        title: input.title,
        category: input.category,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        isCompleted: input.isCompleted,
      },
    })
  );
}

export function deleteTask(id: string) {
  return notFoundAsError("Task not found", () => prisma.task.delete({ where: { id } }));
}

export const getProjects = () => prisma.project.findMany();

export function createProject(input: { name: string; description?: string | null }) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required");

  return prisma.project.create({ data: { name, description: input.description } });
}

export function deleteProject(id: string) {
  return notFoundAsError("Project not found", () => prisma.project.delete({ where: { id } }));
}

export const getHabits = () => prisma.habit.findMany();

export function createHabit(input: { title: string; frequency: HabitFrequency }) {
  const title = input.title.trim();
  if (!title || !HABIT_FREQUENCIES.includes(input.frequency)) {
    throw new Error("Title and a valid frequency are required");
  }

  return prisma.habit.create({ data: { title, frequency: input.frequency } });
}

// Marks a habit done "now" and recomputes its streak based on its frequency window.
export async function completeHabit(id: string): Promise<Habit> {
  const habit = await prisma.habit.findUnique({ where: { id } });
  if (!habit) throw new Error("Habit not found");

  const windowDays = HABIT_WINDOW_DAYS[habit.frequency];
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

export function deleteHabit(id: string) {
  return notFoundAsError("Habit not found", () => prisma.habit.delete({ where: { id } }));
}

export const getRoutines = () => prisma.routine.findMany();

export function createRoutine(input: { title: string; reminderTime: string }) {
  const title = input.title.trim();
  const reminderTime = input.reminderTime.trim();
  if (!title || !reminderTime) throw new Error("Title and reminder time are required");

  return prisma.routine.create({ data: { title, reminderTime } });
}

export function updateRoutine(
  id: string,
  input: Partial<{ title: string; reminderTime: string; isActive: boolean }>
) {
  return notFoundAsError("Routine not found", () => prisma.routine.update({ where: { id }, data: input }));
}

export function deleteRoutine(id: string) {
  return notFoundAsError("Routine not found", () => prisma.routine.delete({ where: { id } }));
}
