// Client-side FormData parsers mirroring the ones in app/actions.ts. The forms keep their
// name= attributes; these turn a submitted form into the typed inputs the optimistic store
// takes, so a create/edit updates the UI instantly and the same shape is sent to the server.

import type { HabitIntervalUnit, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";
import type { HabitInput, ProjectInput, RoutineInput, TaskCreateInput, TaskRepeatInput } from "./store";

const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

export function parseTaskRepeat(fd: FormData): TaskRepeatInput {
  const frequency = String(fd.get("repeatFrequency") ?? "");
  if (!ROUTINE_FREQUENCIES.includes(frequency as RoutineFrequency)) return null;

  const interval = Number(fd.get("repeatInterval") ?? "1");
  const monthlyMode = String(fd.get("repeatMonthlyMode") ?? "DATE") as RoutineMonthlyMode;
  const dayOfMonth = Number(fd.get("repeatDayOfMonth") ?? "");
  const monthlyOrdinal = Number(fd.get("repeatMonthlyOrdinal") ?? "");
  const monthlyWeekday = Number(fd.get("repeatMonthlyWeekday") ?? "");
  return {
    frequency: frequency as RoutineFrequency,
    interval,
    daysOfWeek: fd
      .getAll("repeatDaysOfWeek")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6),
    monthlyMode,
    dayOfMonth: dayOfMonth || null,
    monthlyOrdinal: monthlyOrdinal || null,
    monthlyWeekday: Number.isInteger(monthlyWeekday) && monthlyWeekday >= 0 && monthlyWeekday <= 6 ? monthlyWeekday : null,
  };
}

export function parseTaskForm(fd: FormData): TaskCreateInput {
  const reminderLead = Number(fd.get("reminderLeadMinutes") ?? "");
  return {
    title: String(fd.get("title") ?? "").trim(),
    category: String(fd.get("category") ?? "").trim(),
    description: String(fd.get("description") ?? "").trim() || null,
    dueDate: String(fd.get("dueDate") ?? "").trim() || null,
    dueTime: String(fd.get("dueTime") ?? "").trim() || null,
    projectId: String(fd.get("projectId") ?? "").trim() || null,
    parentId: String(fd.get("parentId") ?? "").trim() || null,
    section: String(fd.get("section") ?? "").trim() || null,
    reminderLeadMinutes: reminderLead > 0 ? reminderLead : null,
    repeat: parseTaskRepeat(fd),
  };
}

export function parseProjectForm(fd: FormData): ProjectInput {
  const reminderLead = Number(fd.get("reminderLeadMinutes") ?? "");
  return {
    name: String(fd.get("name") ?? "").trim(),
    description: String(fd.get("description") ?? "").trim() || null,
    dueDate: String(fd.get("dueDate") ?? "").trim() || null,
    reminderLeadMinutes: reminderLead > 0 ? reminderLead : null,
  };
}

export function parseHabitForm(fd: FormData): HabitInput {
  return {
    title: String(fd.get("title") ?? "").trim(),
    intervalValue: Number(fd.get("intervalValue") ?? ""),
    intervalUnit: String(fd.get("intervalUnit") ?? "") as HabitIntervalUnit,
  };
}

export function parseRoutineForm(fd: FormData): RoutineInput {
  const monthlyWeekday = Number(fd.get("monthlyWeekday") ?? "");
  const dayOfMonth = Number(fd.get("dayOfMonth") ?? "");
  const monthlyOrdinal = Number(fd.get("monthlyOrdinal") ?? "");
  return {
    title: String(fd.get("title") ?? "").trim(),
    reminderTime: String(fd.get("reminderTime") ?? "").trim(),
    frequency: String(fd.get("frequency") ?? "DAILY") as RoutineFrequency,
    interval: Number(fd.get("interval") ?? "1"),
    daysOfWeek: fd
      .getAll("daysOfWeek")
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6),
    monthlyMode: String(fd.get("monthlyMode") ?? "DATE") as RoutineMonthlyMode,
    dayOfMonth: dayOfMonth || null,
    monthlyOrdinal: monthlyOrdinal || null,
    monthlyWeekday: Number.isInteger(monthlyWeekday) && monthlyWeekday >= 0 && monthlyWeekday <= 6 ? monthlyWeekday : null,
  };
}

export function isValidTaskForm(input: TaskCreateInput): boolean {
  return Boolean(input.title && input.category);
}

export function isValidRoutineForm(input: RoutineInput): boolean {
  return Boolean(input.title && input.reminderTime && ROUTINE_FREQUENCIES.includes(input.frequency));
}

export function isValidHabitForm(input: HabitInput): boolean {
  return Boolean(input.title && input.intervalValue && ["DAY", "WEEK", "MONTH"].includes(input.intervalUnit));
}
