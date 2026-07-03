"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  completeHabit,
  createHabit,
  createProject,
  createRoutine,
  createTask,
  deleteHabit,
  deleteProject,
  deleteRoutine,
  deleteTask,
  type HabitFrequency,
  updateRoutine,
  updateTask,
} from "@/lib/api";

const HABIT_FREQUENCIES: HabitFrequency[] = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY"];

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not authenticated");
}

export async function addTask(formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  if (!title || !category) return;

  await createTask({ title, category, dueDate: dueDate || null });
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
  if (!name) return;

  await createProject({ name, description: description || null });
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
  if (!title || !HABIT_FREQUENCIES.includes(frequency)) return;

  await createHabit({ title, frequency });
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

export async function addRoutine(formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  if (!title || !reminderTime) return;

  await createRoutine({ title, reminderTime });
  revalidatePath("/");
}

export async function toggleRoutine(id: string, isActive: boolean) {
  await requireSession();
  await updateRoutine(id, { isActive: !isActive });
  revalidatePath("/");
}

export async function removeRoutine(id: string) {
  await requireSession();
  await deleteRoutine(id);
  revalidatePath("/");
}
