import "server-only";
import type { Task } from "@prisma/client";
import {
  createTask,
  getAppSettings,
  getCategories,
  getDismissedCalendarEventIds,
  getProjects,
  getTasks,
  toggleTaskCompletion,
  updateTask,
} from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import { zonedMinutesOfDay, zonedYMD } from "@/lib/taskbookDates";

// Same face-value encoding as the rest of the app (see combineDueDateTime in api.ts): dueDate is
// UTC midnight of the calendar date, with a clock time layered on top at face value — read back
// with the UTC getters, never local ones.
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function isoTime(d: Date): string | null {
  const hh = d.getUTCHours();
  const mm = d.getUTCMinutes();
  if (hh === 0 && mm === 0) return null; // midnight = "no specific time was set", matches voice.ts
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export type TaskSummary = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  dueDate: string | null;
  dueTime: string | null;
  isCompleted: boolean;
  projectId: string | null;
  projectName: string | null;
  parentId: string | null;
};

function summarize(task: Task, projectNameById: Map<string, string>): TaskSummary {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    dueDate: task.dueDate ? isoDate(task.dueDate) : null,
    dueTime: task.dueDate ? isoTime(task.dueDate) : null,
    isCompleted: task.isCompleted,
    projectId: task.projectId,
    projectName: task.projectId ? (projectNameById.get(task.projectId) ?? null) : null,
    parentId: task.parentId,
  };
}

async function projectNameMap(): Promise<Map<string, string>> {
  const projects = await getProjects();
  return new Map(projects.map((p) => [p.id, p.name]));
}

export type ListTasksArgs = {
  completed?: boolean;
  category?: string;
  projectId?: string;
  dueBefore?: string;
  dueAfter?: string;
  search?: string;
};

// Reads (and flattens) every task including subtasks, then filters in memory — the table is
// small (single-user app) so there's no need for a bespoke Prisma query per filter combination.
export async function listTasks(args: ListTasksArgs = {}): Promise<TaskSummary[]> {
  const [tasks, projectNames] = await Promise.all([getTasks(), projectNameMap()]);
  const flat = tasks.flatMap((t) => [t, ...t.subtasks]);
  const search = args.search?.trim().toLowerCase();
  const dueBefore = args.dueBefore ? new Date(`${args.dueBefore}T23:59:59.999Z`) : null;
  const dueAfter = args.dueAfter ? new Date(`${args.dueAfter}T00:00:00.000Z`) : null;

  return flat
    .filter((t) => args.completed === undefined || t.isCompleted === args.completed)
    .filter((t) => !args.category || t.category === args.category)
    .filter((t) => !args.projectId || t.projectId === args.projectId)
    .filter((t) => !dueBefore || (t.dueDate && t.dueDate <= dueBefore))
    .filter((t) => !dueAfter || (t.dueDate && t.dueDate >= dueAfter))
    .filter((t) => !search || t.title.toLowerCase().includes(search) || t.description?.toLowerCase().includes(search))
    .map((t) => summarize(t, projectNames));
}

export type CreateTaskArgs = {
  title: string;
  category?: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  projectId?: string;
};

export async function createTaskTool(args: CreateTaskArgs): Promise<TaskSummary> {
  const [categories, projectNames] = await Promise.all([getCategories(), projectNameMap()]);
  const category =
    (args.category && categories.some((c) => c.name === args.category) ? args.category : undefined) ??
    categories[0]?.name ??
    "Home";
  const projectId = args.projectId && projectNames.has(args.projectId) ? args.projectId : null;

  const task = await createTask({
    title: args.title,
    category,
    description: args.description || null,
    dueDate: args.dueDate || null,
    dueTime: args.dueTime || null,
    projectId,
  });
  return summarize(task, projectNames);
}

export type UpdateTaskArgs = {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  dueDate?: string | null;
  dueTime?: string;
  projectId?: string | null;
};

export async function updateTaskTool(args: UpdateTaskArgs): Promise<TaskSummary> {
  const projectNames = await projectNameMap();
  const task = await updateTask(args.id, {
    title: args.title,
    description: args.description,
    category: args.category,
    dueDate: args.dueDate,
    dueTime: args.dueTime,
    projectId: args.projectId,
  });
  return summarize(task, projectNames);
}

export type SetTaskCompletedArgs = { id: string; completed: boolean };

export async function setTaskCompleted(args: SetTaskCompletedArgs): Promise<TaskSummary> {
  const projectNames = await projectNameMap();
  const task = await toggleTaskCompletion(args.id, !args.completed);
  return summarize(task, projectNames);
}

export async function listProjects(): Promise<{ id: string; name: string; isCompleted: boolean }[]> {
  const projects = await getProjects();
  return projects.map((p) => ({ id: p.id, name: p.name, isCompleted: p.isCompleted }));
}

export async function listCategories(): Promise<string[]> {
  const categories = await getCategories();
  return categories.map((c) => c.name);
}

export type CalendarEventSummary = {
  id: string;
  title: string;
  /** Calendar date in the user's configured zone, YYYY-MM-DD. */
  date: string;
  /** Local HH:MM start/end, or null for all-day events. */
  startTime: string | null;
  endTime: string | null;
  /** Same instants as ISO UTC, for anything that needs to compute across zones. */
  startIso: string;
  endIso: string;
  allDay: boolean;
  durationMinutes: number | null;
  location: string | null;
  source: string;
};

export type ListCalendarEventsArgs = {
  from?: string;
  to?: string;
  search?: string;
  includeDismissed?: boolean;
};

function hhmm(minutesOfDay: number): string {
  return `${String(Math.floor(minutesOfDay / 60)).padStart(2, "0")}:${String(minutesOfDay % 60).padStart(2, "0")}`;
}

// Read-only view of the synced ICS calendars (Google + Outlook), so an assistant can schedule
// tasks around real commitments. Events are reported in the user's configured zone — unlike task
// due dates (face-value UTC), ICS instants are genuine UTC, so they go through zonedYMD/
// zonedMinutesOfDay exactly as the calendar UI does rather than the isoDate/isoTime helpers above.
//
// Only ~60 days ahead exist at all (CALENDAR_WINDOW_DAYS in lib/calendar.ts) and nothing before
// today, since the feeds only carry upcoming instances. The 5-minute cache is shared with the
// app, so this doesn't add a feed fetch per call.
export async function listCalendarEvents(args: ListCalendarEventsArgs = {}): Promise<CalendarEventSummary[]> {
  const [{ events }, { timeZone }, dismissedIds] = await Promise.all([
    getCalendarEvents(),
    getAppSettings(),
    getDismissedCalendarEventIds(),
  ]);
  const dismissed = new Set(dismissedIds);
  const search = args.search?.trim().toLowerCase();

  return events
    .filter((e) => args.includeDismissed || !dismissed.has(e.id))
    .filter((e) => !search || e.title.toLowerCase().includes(search) || e.location?.toLowerCase().includes(search))
    .map((e) => {
      const start = new Date(e.start);
      const end = new Date(e.end);
      const ymd = zonedYMD(start, timeZone);
      const date = `${ymd.year}-${String(ymd.month0 + 1).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
      return {
        id: e.id,
        title: e.title,
        date,
        startTime: e.allDay ? null : hhmm(zonedMinutesOfDay(start, timeZone)),
        endTime: e.allDay ? null : hhmm(zonedMinutesOfDay(end, timeZone)),
        startIso: e.start,
        endIso: e.end,
        allDay: e.allDay,
        durationMinutes: e.allDay ? null : Math.round((end.getTime() - start.getTime()) / 60000),
        location: e.location,
        source: e.source,
      };
    })
    .filter((e) => (!args.from || e.date >= args.from) && (!args.to || e.date <= args.to))
    .sort((a, b) => (a.date === b.date ? a.startIso.localeCompare(b.startIso) : a.date.localeCompare(b.date)));
}
