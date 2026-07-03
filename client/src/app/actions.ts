"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  completeHabit,
  completeRoutineCluster,
  createCategory,
  createHabit,
  createProject,
  createRoutine,
  createSubroutine,
  createTask,
  deleteCategory,
  deleteHabit,
  deleteProject,
  deleteRoutine,
  deleteTask,
  dismissVoiceCapture,
  type HabitIntervalUnit,
  type RoutineFrequency,
  type RoutineMonthlyMode,
  type TaskRepeatInput,
  toggleTaskCompletion,
  updateCategory,
  updateHabit,
  updateProject,
  updateRoutine,
  updateTask,
} from "@/lib/api";

const HABIT_INTERVAL_UNITS: HabitIntervalUnit[] = ["DAY", "WEEK", "MONTH"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

// Shared by the Add-task form and the inline repeat popover. Empty/missing repeatFrequency
// means "does not repeat" — null clears any existing repeat rule on the task.
function parseTaskRepeat(formData: FormData): TaskRepeatInput | null {
  const frequency = String(formData.get("repeatFrequency") ?? "");
  if (!ROUTINE_FREQUENCIES.includes(frequency as RoutineFrequency)) return null;

  const interval = Number(formData.get("repeatInterval") ?? "1");
  const monthlyMode = String(formData.get("repeatMonthlyMode") ?? "DATE") as RoutineMonthlyMode;
  const dayOfMonth = Number(formData.get("repeatDayOfMonth") ?? "");
  const monthlyOrdinal = Number(formData.get("repeatMonthlyOrdinal") ?? "");
  const monthlyWeekday = Number(formData.get("repeatMonthlyWeekday") ?? "");
  return {
    frequency: frequency as RoutineFrequency,
    interval,
    daysOfWeek: formData
      .getAll("repeatDaysOfWeek")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6),
    monthlyMode,
    dayOfMonth: dayOfMonth || null,
    monthlyOrdinal: monthlyOrdinal || null,
    monthlyWeekday: Number.isInteger(monthlyWeekday) && monthlyWeekday >= 0 && monthlyWeekday <= 6 ? monthlyWeekday : null,
  };
}

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
  const dueTime = String(formData.get("dueTime") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim();
  if (!title || !category) return;

  await createTask({
    title,
    category,
    description: description || null,
    dueDate: dueDate || null,
    dueTime: dueTime || null,
    projectId: projectId || null,
    parentId: parentId || null,
    repeat: parseTaskRepeat(formData),
  });
  revalidatePath("/");
}

// Toggling a repeating task doesn't mark it complete — it rolls the due date forward to the
// next occurrence in place (see toggleTaskCompletion).
export async function toggleTask(id: string, isCompleted: boolean) {
  await requireSession();
  await toggleTaskCompletion(id, isCompleted);
  revalidatePath("/");
}

export async function removeTask(id: string) {
  await requireSession();
  await deleteTask(id);
  revalidatePath("/");
}

export async function renameTask(id: string, formData: FormData) {
  await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await updateTask(id, { title });
  revalidatePath("/");
}

export async function updateTaskDescription(id: string, formData: FormData) {
  await requireSession();
  const description = String(formData.get("description") ?? "").trim();
  await updateTask(id, { description: description || null });
  revalidatePath("/");
}

export async function updateTaskDueDate(id: string, formData: FormData) {
  await requireSession();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const dueTime = String(formData.get("dueTime") ?? "").trim();
  await updateTask(id, { dueDate: dueDate || null, dueTime: dueTime || null });
  revalidatePath("/");
}

export async function updateTaskCategory(id: string, formData: FormData) {
  await requireSession();
  const category = String(formData.get("category") ?? "").trim();
  if (!category) return;
  await updateTask(id, { category });
  revalidatePath("/");
}

export async function updateTaskProject(id: string, formData: FormData) {
  await requireSession();
  const projectId = String(formData.get("projectId") ?? "").trim();
  await updateTask(id, { projectId: projectId || null });
  revalidatePath("/");
}

export async function updateTaskRepeat(id: string, formData: FormData) {
  await requireSession();
  await updateTask(id, { repeat: parseTaskRepeat(formData) });
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

export async function renameProject(id: string, formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await updateProject(id, { name });
  revalidatePath("/");
}

export async function updateProjectDescription(id: string, formData: FormData) {
  await requireSession();
  const description = String(formData.get("description") ?? "").trim();
  await updateProject(id, { description: description || null });
  revalidatePath("/");
}

export async function updateProjectDueDate(id: string, formData: FormData) {
  await requireSession();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  await updateProject(id, { dueDate: dueDate || null });
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
  const intervalValue = Number(formData.get("intervalValue") ?? "");
  const intervalUnit = String(formData.get("intervalUnit") ?? "") as HabitIntervalUnit;
  if (!title || !intervalValue || !HABIT_INTERVAL_UNITS.includes(intervalUnit)) return;

  await createHabit({ title, intervalValue, intervalUnit });
  revalidatePath("/");
}

export async function editHabit(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const intervalValue = Number(formData.get("intervalValue") ?? "");
  const intervalUnit = String(formData.get("intervalUnit") ?? "") as HabitIntervalUnit;
  if (!title || !intervalValue || !HABIT_INTERVAL_UNITS.includes(intervalUnit)) return;

  await updateHabit(id, { title, intervalValue, intervalUnit });
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

function parseRoutineRecurrence(formData: FormData) {
  const frequency = String(formData.get("frequency") ?? "DAILY") as RoutineFrequency;
  const interval = Number(formData.get("interval") ?? "1");
  const monthlyMode = String(formData.get("monthlyMode") ?? "DATE") as RoutineMonthlyMode;
  const dayOfMonth = Number(formData.get("dayOfMonth") ?? "");
  const monthlyOrdinal = Number(formData.get("monthlyOrdinal") ?? "");
  const monthlyWeekday = Number(formData.get("monthlyWeekday") ?? "");
  return {
    frequency,
    interval,
    daysOfWeek: parseDaysOfWeek(formData),
    monthlyMode,
    dayOfMonth: dayOfMonth || null,
    monthlyOrdinal: monthlyOrdinal || null,
    monthlyWeekday: Number.isInteger(monthlyWeekday) && monthlyWeekday >= 0 && monthlyWeekday <= 6 ? monthlyWeekday : null,
  };
}

export async function addRoutine(formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  const recurrence = parseRoutineRecurrence(formData);
  if (!title || !reminderTime || !ROUTINE_FREQUENCIES.includes(recurrence.frequency)) return;

  await createRoutine({ title, reminderTime, ...recurrence });
  revalidatePath("/");
}

export async function editRoutine(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  const recurrence = parseRoutineRecurrence(formData);
  if (!title || !reminderTime || !ROUTINE_FREQUENCIES.includes(recurrence.frequency)) return;

  await updateRoutine(id, { title, reminderTime, ...recurrence });
  revalidatePath("/");
}

export async function toggleRoutine(id: string, isActive: boolean) {
  await requireSession();
  await updateRoutine(id, { isActive: !isActive });
  revalidatePath("/");
}

// Ticks the whole cluster (this routine plus every sibling under the same parent) done together.
export async function tickRoutine(id: string) {
  await requireSession();
  await completeRoutineCluster(id);
  revalidatePath("/");
}

export async function removeRoutine(id: string) {
  await requireSession();
  await deleteRoutine(id);
  revalidatePath("/");
}

export async function addSubroutine(parentId: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  await createSubroutine(parentId, title);
  revalidatePath("/");
}

export async function addCategory(formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await createCategory(name);
  revalidatePath("/");
}

export async function renameCategory(id: string, formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await updateCategory(id, name);
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
