"use server";

import { auth } from "@/auth";
import {
  acceptSuggestion as acceptSuggestionApi,
  type CapturedKind,
  type CategoryScope,
  completeHabit,
  createAiNote,
  createDayPlanBlock,
  deleteAiNote,
  deleteDayPlanBlock,
  respondToSuggestion,
  updateDayPlanBlock as updateDayPlanBlockApi,
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
  dismissCalendarEvent as dismissCalendarEventApi,
  dismissVoiceCapture,
  duplicateProject as duplicateProjectApi,
  type HabitScheduleType,
  reorderTasks as reorderTasksApi,
  restoreCalendarEvent as restoreCalendarEventApi,
  type RoutineFrequency,
  type RoutineMonthlyMode,
  createCountdown,
  deleteCountdown,
  setProjectSections,
  type TaskRepeatInput,
  updateCountdown as updateCountdownApi,
  toggleHabitCompletion as toggleHabitCompletionApi,
  toggleTaskCompletion,
  untickRoutineCluster,
  updateCategory,
  updateCategoryScope as updateCategoryScopeApi,
  updateHabit,
  updateProject,
  updateRoutine,
  updateTask,
  updateTimeZone as updateTimeZoneApi,
} from "@/lib/api";
import { CALENDAR_CACHE_TAG, getCalendarEvents } from "@/lib/calendar";
import { parseDurationInput } from "@/lib/shared";
// updateTag (not revalidateTag) — this is a read-your-own-writes refresh: it must expire the
// calendar cache immediately, not serve the stale snapshot while refetching in the background.
import { updateTag } from "next/cache";

// NOTE ON REVALIDATION: these actions no longer call revalidatePath("/"). The client applies
// every change optimistically (see components/taskbook/store.tsx) and reconciles with server
// truth by calling router.refresh() when the tab regains focus (or if a write fails). That
// keeps a click's server work to a single write instead of re-rendering the whole page — which
// was the ~8s "click to update" lag. Create actions return the new row's id so the client can
// swap its temporary optimistic id for the real one.

const HABIT_SCHEDULE_TYPES: HabitScheduleType[] = ["WEEKLY_DAYS", "WEEKLY_COUNT", "MONTHLY_COUNT"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];

// Parses the habit schedule fields shared by add/edit. `daysOfWeek` arrives as a comma-separated
// hidden input (e.g. "1,2,3,4,5,6"); `targetCount` as a number. Returns null on invalid input.
function parseHabitSchedule(
  formData: FormData
): { scheduleType: HabitScheduleType; targetCount: number; daysOfWeek: number[] } | null {
  const scheduleType = String(formData.get("scheduleType") ?? "") as HabitScheduleType;
  if (!HABIT_SCHEDULE_TYPES.includes(scheduleType)) return null;
  const daysOfWeek = String(formData.get("daysOfWeek") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const targetCount = Number(formData.get("targetCount") ?? "");
  if (scheduleType === "WEEKLY_DAYS") {
    if (daysOfWeek.length === 0) return null;
  } else if (!Number.isInteger(targetCount) || targetCount < 1) {
    return null;
  }
  return { scheduleType, targetCount: targetCount || 1, daysOfWeek };
}

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
  const repeatUntil = String(formData.get("repeatUntil") ?? "").trim();
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
    repeatUntil: /^\d{4}-\d{2}-\d{2}$/.test(repeatUntil) ? repeatUntil : null,
  };
}

async function requireSession() {
  const session = await auth();
  if (!session) throw new Error("Not authenticated");
}

export async function addTask(formData: FormData): Promise<string | undefined> {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const dueTime = String(formData.get("dueTime") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim();
  const section = String(formData.get("section") ?? "").trim();
  const reminderLead = Number(formData.get("reminderLeadMinutes") ?? "");
  if (!title || !category) return;

  const task = await createTask({
    title,
    category,
    description: description || null,
    dueDate: dueDate || null,
    dueTime: dueTime || null,
    projectId: projectId || null,
    parentId: parentId || null,
    section: section || null,
    reminderLeadMinutes: reminderLead > 0 ? reminderLead : null,
    durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")),
    repeat: parseTaskRepeat(formData),
  });
  return task.id;
}

// Toggling a repeating task doesn't mark it complete — it rolls the due date forward to the
// next occurrence in place (see toggleTaskCompletion).
export async function toggleTask(id: string, isCompleted: boolean) {
  await requireSession();
  await toggleTaskCompletion(id, isCompleted);
}

export async function removeTask(id: string) {
  await requireSession();
  await deleteTask(id);
}

export async function renameTask(id: string, formData: FormData) {
  await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  await updateTask(id, { title });
}

export async function updateTaskDescription(id: string, formData: FormData) {
  await requireSession();
  const description = String(formData.get("description") ?? "").trim();
  await updateTask(id, { description: description || null });
}

export async function updateTaskDueDate(id: string, formData: FormData) {
  await requireSession();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const dueTime = String(formData.get("dueTime") ?? "").trim();
  await updateTask(id, { dueDate: dueDate || null, dueTime: dueTime || null });
}

export async function updateTaskCategory(id: string, formData: FormData) {
  await requireSession();
  const category = String(formData.get("category") ?? "").trim();
  if (!category) return;
  await updateTask(id, { category });
}

export async function updateTaskProject(id: string, formData: FormData) {
  await requireSession();
  const projectId = String(formData.get("projectId") ?? "").trim();
  await updateTask(id, { projectId: projectId || null });
}

export async function updateTaskRepeat(id: string, formData: FormData) {
  await requireSession();
  await updateTask(id, { repeat: parseTaskRepeat(formData) });
}

export async function updateTaskPause(id: string, formData: FormData) {
  await requireSession();
  const pausedUntil = String(formData.get("pausedUntil") ?? "").trim();
  await updateTask(id, { pausedUntil: pausedUntil || null });
}

export async function updateTaskSection(id: string, formData: FormData) {
  await requireSession();
  const section = String(formData.get("section") ?? "").trim();
  await updateTask(id, { section: section || null });
}

export async function updateTaskReminderLead(id: string, formData: FormData) {
  await requireSession();
  const lead = Number(formData.get("reminderLeadMinutes") ?? "");
  await updateTask(id, { reminderLeadMinutes: lead > 0 ? lead : null });
}

// Set/clear the on-hold marker: an empty reason clears the block entirely.
export async function updateTaskBlock(id: string, formData: FormData) {
  await requireSession();
  const reason = String(formData.get("blockedReason") ?? "").trim();
  const until = String(formData.get("blockedUntil") ?? "").trim();
  await updateTask(id, {
    blockedReason: reason || null,
    blockedUntil: reason && /^\d{4}-\d{2}-\d{2}$/.test(until) ? until : null,
  });
}

export async function updateTaskDuration(id: string, formData: FormData) {
  await requireSession();
  await updateTask(id, { durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")) });
}

// Rewrites the manual order of a whole group (due bucket / project section) in one call —
// the ids arrive in their new display order.
export async function reorderTaskGroup(formData: FormData) {
  await requireSession();
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length) await reorderTasksApi(ids);
}

// --- Countdowns (important-event countdowns in the calendar rail) ---

function parseCountdownFields(formData: FormData): { title: string; date: string; repeatsYearly: boolean } | null {
  const title = String(formData.get("title") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { title, date, repeatsYearly: String(formData.get("repeatsYearly")) === "true" };
}

export async function addCountdown(formData: FormData): Promise<string | undefined> {
  await requireSession();
  const input = parseCountdownFields(formData);
  if (!input) return;
  const countdown = await createCountdown(input);
  return countdown.id;
}

export async function editCountdown(id: string, formData: FormData) {
  await requireSession();
  const input = parseCountdownFields(formData);
  if (!input) return;
  await updateCountdownApi(id, input);
}

export async function removeCountdown(id: string) {
  await requireSession();
  await deleteCountdown(id);
}

// --- My Day plan blocks ---

const CAPTURED_KINDS: CapturedKind[] = ["TASK", "PROJECT", "ROUTINE", "HABIT"];

function parseTimeValue(raw: string): string | null {
  return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

export async function addDayPlanBlock(formData: FormData): Promise<string | undefined> {
  await requireSession();

  const date = String(formData.get("date") ?? "").trim();
  const entityType = String(formData.get("entityType") ?? "") as CapturedKind;
  const entityId = String(formData.get("entityId") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !CAPTURED_KINDS.includes(entityType) || !entityId) return;

  const sortOrder = Number(formData.get("sortOrder") ?? "");
  const block = await createDayPlanBlock({
    date,
    entityType,
    entityId,
    startTime: parseTimeValue(String(formData.get("startTime") ?? "").trim()),
    durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")),
    sortOrder: Number.isFinite(sortOrder) && sortOrder !== 0 ? sortOrder : null,
  });
  return block.id;
}

// Whole-record update: covers move-to-time (pin), unpin, edit-duration and push-to-another-day.
export async function editDayPlanBlock(id: string, formData: FormData) {
  await requireSession();

  const date = String(formData.get("date") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder") ?? "");
  await updateDayPlanBlockApi(id, {
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    startTime: parseTimeValue(String(formData.get("startTime") ?? "").trim()),
    durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")),
    sortOrder: Number.isFinite(sortOrder) && sortOrder !== 0 ? sortOrder : null,
  });
}

export async function removeDayPlanBlock(id: string) {
  await requireSession();
  await deleteDayPlanBlock(id);
}

export async function addProject(formData: FormData): Promise<string | undefined> {
  await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const reminderLead = Number(formData.get("reminderLeadMinutes") ?? "");
  if (!name) return;

  const project = await createProject({
    name,
    description: description || null,
    dueDate: dueDate || null,
    reminderLeadMinutes: reminderLead > 0 ? reminderLead : null,
    durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")),
  });
  return project.id;
}

// "New from template": server-computed copy of an existing project and its tasks. Not
// optimistic — the caller refreshes after it resolves (creating a whole task tree client-side
// would duplicate too much server logic for a rare operation).
export async function duplicateProject(id: string, formData: FormData): Promise<string | undefined> {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const project = await duplicateProjectApi(id, name || null);
  return project.id;
}

export async function editProject(id: string, formData: FormData) {
  await requireSession();

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const reminderLead = Number(formData.get("reminderLeadMinutes") ?? "");
  if (!name) return;

  await updateProject(id, {
    name,
    description: description || null,
    dueDate: dueDate || null,
    reminderLeadMinutes: reminderLead > 0 ? reminderLead : null,
    durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")),
  });
}

export async function renameProject(id: string, formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await updateProject(id, { name });
}

export async function updateProjectDescription(id: string, formData: FormData) {
  await requireSession();
  const description = String(formData.get("description") ?? "").trim();
  await updateProject(id, { description: description || null });
}

export async function updateProjectDueDate(id: string, formData: FormData) {
  await requireSession();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  await updateProject(id, { dueDate: dueDate || null });
}

// Toggle Things-style sections on a project card; disabling clears every task's section.
export async function updateProjectSections(id: string, enabled: boolean) {
  await requireSession();
  await setProjectSections(id, enabled);
}

export async function toggleProject(id: string, isCompleted: boolean) {
  await requireSession();
  await updateProject(id, { isCompleted: !isCompleted });
}

export async function removeProject(id: string) {
  await requireSession();
  await deleteProject(id);
}

export async function addHabit(formData: FormData): Promise<string | undefined> {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const schedule = parseHabitSchedule(formData);
  if (!title || !schedule) return;

  const habit = await createHabit({ title, ...schedule, durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")) });
  return habit.id;
}

export async function editHabit(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const schedule = parseHabitSchedule(formData);
  if (!title || !schedule) return;

  await updateHabit(id, { title, ...schedule, durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")) });
}

// Sets or clears a habit's planned break band (both dates required to set; empty = clear).
export async function updateHabitPause(id: string, formData: FormData) {
  await requireSession();
  const start = String(formData.get("pauseStart") ?? "").trim();
  const end = String(formData.get("pauseEnd") ?? "").trim();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end);
  await updateHabit(id, valid ? { pauseStart: start, pauseEnd: end } : { pauseStart: null, pauseEnd: null });
}

export async function markHabitDone(id: string) {
  await requireSession();
  await completeHabit(id);
}

export async function toggleHabitCompletion(id: string, dateKey: string) {
  await requireSession();
  await toggleHabitCompletionApi(id, dateKey);
}

export async function removeHabit(id: string) {
  await requireSession();
  await deleteHabit(id);
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

export async function addRoutine(formData: FormData): Promise<string | undefined> {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  const recurrence = parseRoutineRecurrence(formData);
  if (!title || !reminderTime || !ROUTINE_FREQUENCIES.includes(recurrence.frequency)) return;

  const routine = await createRoutine({ title, reminderTime, durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")), ...recurrence });
  return routine.id;
}

export async function editRoutine(id: string, formData: FormData) {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  const reminderTime = String(formData.get("reminderTime") ?? "").trim();
  const recurrence = parseRoutineRecurrence(formData);
  if (!title || !reminderTime || !ROUTINE_FREQUENCIES.includes(recurrence.frequency)) return;

  await updateRoutine(id, { title, reminderTime, durationMinutes: parseDurationInput(String(formData.get("duration") ?? "")), ...recurrence });
}

export async function updateRoutinePause(id: string, formData: FormData) {
  await requireSession();
  const pausedUntil = String(formData.get("pausedUntil") ?? "").trim();
  await updateRoutine(id, { pausedUntil: pausedUntil || null });
}

export async function toggleRoutine(id: string, isActive: boolean) {
  await requireSession();
  await updateRoutine(id, { isActive: !isActive });
}

// Ticks the whole cluster (this routine plus every sibling under the same parent) done together.
export async function tickRoutine(id: string) {
  await requireSession();
  await completeRoutineCluster(id);
}

// Un-ticks a cluster (e.g. one the notification cron auto-ticked but wasn't actually done).
export async function untickRoutine(id: string) {
  await requireSession();
  await untickRoutineCluster(id);
}

export async function removeRoutine(id: string) {
  await requireSession();
  await deleteRoutine(id);
}

export async function addSubroutine(parentId: string, formData: FormData): Promise<string | undefined> {
  await requireSession();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const subroutine = await createSubroutine(parentId, title);
  return subroutine.id;
}

const CATEGORY_SCOPES: CategoryScope[] = ["WORK", "HOME", "NONE"];

export async function addCategory(formData: FormData): Promise<string | undefined> {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  const scope = String(formData.get("scope") ?? "NONE") as CategoryScope;
  if (!name) return;
  const category = await createCategory(name, CATEGORY_SCOPES.includes(scope) ? scope : "NONE");
  return category.id;
}

export async function setCategoryScope(id: string, formData: FormData) {
  await requireSession();
  const scope = String(formData.get("scope") ?? "") as CategoryScope;
  if (!CATEGORY_SCOPES.includes(scope)) return;
  await updateCategoryScopeApi(id, scope);
}

export async function renameCategory(id: string, formData: FormData) {
  await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await updateCategory(id, name);
}

export async function removeCategory(id: string) {
  await requireSession();
  await deleteCategory(id);
}

export async function dismissCapture(id: string) {
  await requireSession();
  await dismissVoiceCapture(id);
}

export async function updateTimeZone(timeZone: string) {
  await requireSession();
  await updateTimeZoneApi(timeZone);
}

// --- AI planner suggestions + notes (My Day) ---

// Regenerate suggestions on demand (the ↻ button). Called directly (not via the outbox) — it
// needs a connection anyway, and the caller refreshes with the result.
export async function refreshSuggestions(): Promise<{ created: number; skipped: number }> {
  await requireSession();
  const { generateSuggestions } = await import("@/lib/suggestions");
  return generateSuggestions();
}

export async function acceptSuggestion(id: string, formData: FormData): Promise<string | undefined> {
  await requireSession();
  const category = String(formData.get("category") ?? "").trim();
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  if (!category) return;
  const task = await acceptSuggestionApi(id, { category, dueDate: dueDate || null });
  return task.id;
}

export async function snoozeSuggestion(id: string, formData: FormData) {
  await requireSession();
  const until = String(formData.get("snoozedUntil") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return;
  await respondToSuggestion(id, "SNOOZED", until);
}

export async function dismissSuggestion(id: string) {
  await requireSession();
  await respondToSuggestion(id, "DISMISSED");
}

export async function addAiNote(formData: FormData): Promise<string | undefined> {
  await requireSession();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;
  const note = await createAiNote(content);
  return note.id;
}

export async function removeAiNote(id: string) {
  await requireSession();
  await deleteAiNote(id);
}

export async function dismissCalendarEvent(eventId: string) {
  await requireSession();
  await dismissCalendarEventApi(eventId);
}

export async function restoreCalendarEvent(eventId: string) {
  await requireSession();
  await restoreCalendarEventApi(eventId);
}

// Manual "pull the ICS feeds again now" — expires the 5-minute calendar cache so the very next
// render refetches Google/Outlook instead of serving the last snapshot. Returns the freshly
// fetched result so the caller can report per-feed failures; the client follows this with a
// router.refresh() to pick the new events up through the normal SSR path.
export async function refreshCalendarFeeds(): Promise<{ count: number; errors: string[] }> {
  await requireSession();
  updateTag(CALENDAR_CACHE_TAG);
  const { events, errors } = await getCalendarEvents();
  return { count: events.length, errors };
}
