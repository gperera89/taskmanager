"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  completeHabit,
  completeRoutine,
  createCategory,
  createHabit,
  createProject,
  createRoutine,
  createTask,
  deleteCategory,
  deleteHabit,
  deleteProject,
  deleteRoutine,
  deleteTask,
  dismissVoiceCapture,
  type HabitFrequency,
  type RoutineFrequency,
  updateHabit,
  updateProject,
  updateRoutine,
  updateTask,
} from "@/lib/api";

const HABIT_FREQUENCIES: HabitFrequency[] = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not authenticated");
}

export async function addTask(formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim();
  if (!title || !category) return;

  await createTask({
    title,
    category,
    description: description || null,
    dueDate: dueDate || null,
    projectId: projectId || null,
    parentId: parentId || null,
  });
  revalidatePath("/");
}

export async function editTask(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  if (!title || !category) return;

  await updateTask(id, {
    title,
    category,
    description: description || null,
    dueDate: dueDate || null,
    projectId: projectId || null,
  });
  revalidatePath("/");
}

export async function toggleTask(id: string, isCompleted: boolean) {
  await requireSession();
  await updateTask(id, { isCompleted: !isCompleted });
  revalidatePath("/");
}

export async function removeTask(id: string) {
  await requireSession();
  await deleteTask(id);
  revalidatePath("/");
}

export async function addProject(formData: FormData) {
  await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  if (!name) return;

  await createProject({ name, description: description || null, dueDate: dueDate || null });
  revalidatePath("/");
}

export async function editProject(id: string, formData: FormData) {
  await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  if (!name) return;

  await updateProject(id, { name, description: description || null, dueDate: dueDate || null });
  revalidatePath("/");
}

export async function toggleProject(id: string, isCompleted: boolean) {
  await requireSession();
  await updateProject(id, { isCompleted: !isCompleted });
  revalidatePath("/");
}

export async function removeProject(id: string) {
  await requireSession();
  await deleteProject(id);
  revalidatePath("/");
}

export async function addHabit(formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "") as HabitFrequency;
  const customIntervalDays = Number(formData.get("customIntervalDays") ?? "");
  if (!title || !HABIT_FREQUENCIES.includes(frequency)) return;

  await createHabit({ title, frequency, customIntervalDays: customIntervalDays || null });
  revalidatePath("/");
}

export async function editHabit(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "") as HabitFrequency;
  const customIntervalDays = Number(formData.get("customIntervalDays") ?? "");
  if (!title || !HABIT_FREQUENCIES.includes(frequency)) return;

  await updateHabit(id, { title, frequency, customIntervalDays: customIntervalDays || null });
  revalidatePath("/");
}

export async function markHabitDone(id: string) {
  await requireSession();
  await completeHabit(id);
  revalidatePath("/");
}

export async function removeHabit(id: string) {
  await requireSession();
  await deleteHabit(id);
  revalidatePath("/");
}

function parseDaysOfWeek(formData: FormData): number[] {
  return formData
    .getAll("daysOfWeek")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
}

export async function addRoutine(formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "DAILY") as RoutineFrequency;
  const dayOfMonth = Number(formData.get("dayOfMonth") ?? "");
  if (!title || !reminderTime || !ROUTINE_FREQUENCIES.includes(frequency)) return;

  await createRoutine({
    title,
    reminderTime,
    frequency,
    daysOfWeek: parseDaysOfWeek(formData),
    dayOfMonth: dayOfMonth || null,
  });
  revalidatePath("/");
}

export async function editRoutine(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "DAILY") as RoutineFrequency;
  const dayOfMonth = Number(formData.get("dayOfMonth") ?? "");
  if (!title || !reminderTime || !ROUTINE_FREQUENCIES.includes(frequency)) return;

  await updateRoutine(id, {
    title,
    reminderTime,
    frequency,
    daysOfWeek: parseDaysOfWeek(formData),
    dayOfMonth: dayOfMonth || null,
  });
  revalidatePath("/");
}

export async function toggleRoutine(id: string, isActive: boolean) {
  await requireSession();
  await updateRoutine(id, { isActive: !isActive });
  revalidatePath("/");
}

export async function tickRoutine(id: string) {
  await requireSession();
  await completeRoutine(id);
  revalidatePath("/");
}

export async function removeRoutine(id: string) {
  await requireSession();
  await deleteRoutine(id);
  revalidatePath("/");
}

export async function addCategory(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await createCategory(name);
  revalidatePath("/");
}

export async function removeCategory(id: string) {
  await requireSession();
  await deleteCategory(id);
  revalidatePath("/");
}

export async function dismissCapture(id: string) {
  await requireSession();
  await dismissVoiceCapture(id);
  revalidatePath("/");
}
