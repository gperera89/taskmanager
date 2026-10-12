"use client";

// The optimistic client store. Holds the raw entity rows seeded from the server, applies every
// interaction to that local state *immediately* (so the UI reacts in ~0ms), and records the
// matching server action in a durable IndexedDB outbox that a single flusher drains in order.
//
// Online, the outbox drains within milliseconds — behavior matches the old fire-and-forget
// design. Offline (or when a write hits a network error), ops queue up and drain when the
// connection returns: `online` events, visibility changes and a capped exponential backoff
// are the only wake-ups — no polling, so an offline device idles at zero cost.
//
// The raw state itself is snapshotted to IndexedDB on every change; when the service worker
// serves a cached shell (offline start) or queued ops exist, the snapshot re-hydrates the UI.
//
// View-models are re-derived from raw state via deriveEntities() on every change, so grouping,
// due-bucketing, counts and streaks all update exactly as a server round trip would have.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AiNote, CapturedKind, Note, Countdown, DayPlanBlock, HabitCompletion, HabitScheduleType, Routine, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";
import * as serverActions from "@/app/actions";
import { deriveEntities, type RawState, type RawTask } from "@/lib/derive";
import { formatLongDate } from "@/lib/taskbookDates";
import {
  combineDueDateTime,
  habitDateKey,
  NO_REPEAT,
  utcCalendarDay,
} from "@/lib/shared";
import {
  deserializeArg,
  idbAvailable,
  isNetworkError,
  kvGet,
  kvSet,
  MAX_OP_ATTEMPTS,
  outboxAdd,
  outboxBumpAttempts,
  outboxCount,
  outboxDelete,
  outboxPeek,
  remapArgIds,
  serializeArg,
  type SerializedArg,
} from "@/lib/offline";
import { nextOccurrence, resolveTaskRepeat, type TaskRepeatRule } from "@/lib/taskRecurrence";
import {
  assignBlockIds,
  bodyHasBlock,
  defaultNoteTaskCategory,
  planNoteTaskSync,
  removeBlockLine,
  setBlockChecked,
  setBlockTitle,
} from "@/lib/noteTasks";
import AppFrame from "./AppFrame";
import type { CalendarEvent, CategoryScopeOption, Mode, TaskbookData } from "./types";

// Persists the work/home/all toggle across sessions — this is a pure client display
// preference, not server state, so it lives in localStorage rather than the DB.
const MODE_STORAGE_KEY = "taskbook-mode";

const SNAPSHOT_KEY = "snapshot-v1";
const IDMAP_KEY = "idmap-v1";

// Undo window for destructive actions: the row disappears from the UI immediately, but the
// server delete is only enqueued once this window closes without an Undo.
const UNDO_MS = 6000;

// Focus/visibility refreshes are useful but arrive in pairs (both events fire) — collapse
// anything within this window into one server round trip.
const REFRESH_DEBOUNCE_MS = 5000;

// How often a *visible* tab asks whether anything has changed. Cura sits open for hours on the
// desktop, where the only reconcile trigger was a focus event — so an edit made on the phone, or
// a voice capture, sat unseen until the window was clicked away from and back. This is the same
// cheap fingerprint check as on open, so a quiet database costs one small request per tick and
// changes no state at all. Budget: one operation per tick, ~20/hour of screen time — set against
// the ~43k/month the notification cron already spends, that's small, but it is the reason this
// is minutes rather than seconds, and why a hidden tab never ticks.
const VERSION_POLL_MS = 3 * 60_000;

// How long the app waits on IndexedDB before giving up and drawing the server's rows. WebKit's
// IndexedDB can stall on the first open after a cold launch; the splash must never hang on it.
const HYDRATE_TIMEOUT_MS = 1500;

// A page render this much older than the device clock was served from the service worker's
// cache, not the network (see sw.js) — so its rows are from a previous visit, and the device's
// own snapshot (which also carries that visit's edits) is the better starting point. Generous on
// purpose: a fresh network render is milliseconds old, and a device clock a few seconds off must
// not tip the comparison.
const CACHED_SHELL_AGE_MS = 30_000;

// Rows persisted by an older deploy can predate fields added since — backfill them so the
// derivers never trip over a missing array.
function withRawDefaults(raw: RawState): RawState {
  return {
    ...raw,
    notes: raw.notes ?? [],
    dayPlanBlocks: raw.dayPlanBlocks ?? [],
    suggestions: raw.suggestions ?? [],
    aiNotes: raw.aiNotes ?? [],
    countdowns: raw.countdowns ?? [],
  };
}

function isMode(v: string | null): v is Mode {
  return v === "work" || v === "home" || v === "all";
}

// Server snapshot fields that this store does NOT derive (labels/heartbeat — the calendar view
// itself is computed by deriveCalendarView, called from TaskbookApp since it also needs the
// viewed month, which this store doesn't own). `calendarErrors` is excluded too: the calendar
// now streams in after the initial render, so its errors aren't known when this object is built.
export type ServerCalendarData = Omit<
  TaskbookData,
  | "calendarErrors"
  | "taskGroups"
  | "tasksRemainingToday"
  | "projectCards"
  | "activeProjectCount"
  | "routineList"
  | "routineTotalCount"
  | "habits"
  | "habitAtRiskCount"
  | "countdowns"
  | "projectOptions"
  | "categoryOptions"
  | "pendingCaptures"
  | "notes"
>;

export type TaskRepeatInput = {
  frequency: RoutineFrequency;
  interval?: number;
  daysOfWeek?: number[];
  monthlyMode?: RoutineMonthlyMode;
  dayOfMonth?: number | null;
  monthlyOrdinal?: number | null;
  monthlyWeekday?: number | null;
  repeatUntil?: string | null; // series end date "YYYY-MM-DD", null = forever
} | null;

export type TaskCreateInput = {
  title: string;
  category: string;
  description?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  repeat?: TaskRepeatInput;
  section?: string | null;
  reminderLeadMinutes?: number | null;
  durationMinutes?: number | null;
};

export type ProjectInput = { name: string; description?: string | null; dueDate?: string | null; reminderLeadMinutes?: number | null; durationMinutes?: number | null };
export type HabitInput = { title: string; scheduleType: HabitScheduleType; targetCount: number; daysOfWeek: number[]; durationMinutes?: number | null };
export type RoutineInput = {
  title: string;
  reminderTime: string;
  durationMinutes: number | null;
  frequency: RoutineFrequency;
  interval: number;
  daysOfWeek: number[];
  monthlyMode: RoutineMonthlyMode;
  dayOfMonth: number | null;
  monthlyOrdinal: number | null;
  monthlyWeekday: number | null;
};

export type CountdownInput = {
  title: string;
  date: string; // "YYYY-MM-DD" — the original date (birth/wedding year for yearly events)
  repeatsYearly: boolean;
};

export type DayPlanBlockInput = {
  date: string; // "YYYY-MM-DD"
  entityType: CapturedKind;
  entityId: string;
  startTime?: string | null; // "HH:MM" — set = pinned at that time
  durationMinutes?: number | null;
};

export type Toast = {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type TaskbookActions = {
  // Tasks (toggle/remove/rename also accept subtask ids)
  addTask: (input: TaskCreateInput) => void;
  toggleTask: (id: string, isCompleted: boolean) => void;
  removeTask: (id: string) => void;
  renameTask: (id: string, title: string) => void;
  setTaskDescription: (id: string, description: string) => void;
  setTaskCategory: (id: string, category: string) => void;
  setTaskProject: (id: string, projectId: string) => void;
  setTaskDue: (id: string, dueDate: string, dueTime: string) => void;
  setTaskRepeat: (id: string, repeat: TaskRepeatInput) => void;
  setTaskPause: (id: string, pausedUntil: string) => void; // empty clears the break
  setTaskSection: (id: string, section: string) => void;
  setTaskReminderLead: (id: string, minutes: number | null) => void;
  setTaskDuration: (id: string, minutes: number | null) => void;
  setTaskBlock: (id: string, reason: string, untilDate: string) => void; // empty reason clears
  reorderGroup: (orderedIds: string[]) => void;
  // Projects
  // Returns the new project's temp id, so a note can be attached to it straight away (queued ops
  // that reference the temp id are remapped to the real one when they flush).
  addProject: (input: ProjectInput) => string;
  editProject: (id: string, input: ProjectInput) => void;
  duplicateProject: (templateId: string, name: string) => void;
  renameProject: (id: string, name: string) => void;
  setProjectDescription: (id: string, description: string) => void;
  setProjectDueDate: (id: string, dueDate: string) => void;
  toggleProject: (id: string, isCompleted: boolean) => void;
  setProjectSections: (id: string, enabled: boolean) => void;
  removeProject: (id: string) => void;
  // Notes. addNote returns the new note's id (client-minted, final — no temp-id swap), so the
  // caller can open the editor on it straight away.
  addNote: (input: { title?: string; projectId?: string | null }) => string;
  renameNote: (id: string, title: string) => void;
  // Saves a note's body and syncs its checkbox lines with their tasks (creating, renaming and
  // ticking them). Returns the body as it should now read — with block ids added to new checkbox
  // lines — for the editor to adopt.
  saveNoteBody: (id: string, body: string) => string;
  setNoteProject: (id: string, projectId: string | null) => void;
  removeNote: (id: string) => void;
  // Countdowns
  addCountdown: (input: CountdownInput) => void;
  editCountdown: (id: string, input: CountdownInput) => void;
  removeCountdown: (id: string) => void;
  // Habits
  addHabit: (input: HabitInput) => void;
  editHabit: (id: string, input: HabitInput) => void;
  markHabitDone: (id: string) => void;
  toggleHabitCompletion: (habitId: string, dateKey: string) => void;
  setHabitPause: (id: string, pauseStart: string, pauseEnd: string) => void; // empty clears
  removeHabit: (id: string) => void;
  // Routines
  addRoutine: (input: RoutineInput) => void;
  editRoutine: (id: string, input: RoutineInput) => void;
  addSubroutine: (parentId: string, title: string) => void;
  tickRoutine: (id: string) => void;
  untickRoutine: (id: string) => void;
  setRoutinePause: (id: string, pausedUntil: string) => void;
  removeRoutine: (id: string) => void;
  // Categories
  addCategory: (name: string) => void;
  renameCategory: (id: string, name: string) => void;
  setCategoryScope: (id: string, scope: CategoryScopeOption) => void;
  removeCategory: (id: string) => void;
  // My Day plan blocks
  addDayPlanBlock: (input: DayPlanBlockInput) => void;
  updateDayPlanBlock: (id: string, input: Partial<Omit<DayPlanBlockInput, "entityType" | "entityId">>) => void;
  removeDayPlanBlock: (id: string) => void;
  // AI planner suggestions + notes
  acceptSuggestion: (id: string, category: string, dueDate: string | null) => void;
  snoozeSuggestion: (id: string, untilDate: string) => void;
  dismissSuggestion: (id: string) => void;
  addAiNote: (content: string) => void;
  removeAiNote: (id: string) => void;
  // Voice captures
  dismissCapture: (id: string) => void;
  // Settings / calendar
  setTimeZone: (timeZone: string) => void;
  dismissEvent: (eventId: string) => void;
  restoreEvent: (eventId: string) => void;
};

// `raw`/`calendarEvents`/`nowMs` are exposed alongside the derived `data` so TaskbookApp can call
// deriveCalendarView itself with the viewed month it owns (this store doesn't track navigation).
type TaskbookContextValue = {
  data: TaskbookData;
  actions: TaskbookActions;
  raw: RawState;
  calendarEvents: CalendarEvent[];
  // Manual ICS re-pull (Google/Outlook), separate from `actions` since it's a read, not a mutation.
  refreshCalendar: () => void;
  calendarRefreshing: boolean;
  // Manual "pull server truth now" — the same reconcile the tab does on focus, on demand, for
  // when a phone has been asleep and the focus event either hasn't fired or is still in flight.
  syncNow: () => void;
  syncing: boolean;
  nowMs: number;
  mode: Mode;
  setMode: (mode: Mode) => void;
  offline: boolean;
  pendingOps: number;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  subscribeNoteEdits: (noteId: string, fn: (transform: (body: string) => string) => void) => () => void;
};

const TaskbookContext = createContext<TaskbookContextValue | null>(null);

export function useTaskbook(): TaskbookContextValue {
  const ctx = useContext(TaskbookContext);
  if (!ctx) throw new Error("useTaskbook must be used within <StoreProvider>");
  return ctx;
}

// --- Raw-row builders / patch helpers ---

let tempSeq = 0;
function tempId(): string {
  tempSeq += 1;
  return `tmp-${Date.now()}-${tempSeq}`;
}

// --- Habit helpers (mirror the FormData contract in app/actions.ts) ---

function habitFormData(input: HabitInput): FormData {
  const fd = new FormData();
  fd.set("title", input.title);
  fd.set("scheduleType", input.scheduleType);
  fd.set("targetCount", String(input.targetCount));
  fd.set("daysOfWeek", input.daysOfWeek.join(","));
  if (input.durationMinutes) fd.set("duration", String(input.durationMinutes));
  return fd;
}

// The tz-agnostic YYYY-MM-DD key of a completion row (its date is stored at UTC midnight).
function completionKey(c: HabitCompletion): string {
  return new Date(c.date).toISOString().slice(0, 10);
}

function hasCompletion(r: RawState, habitId: string, dateKey: string): boolean {
  return r.habitCompletions.some((c) => c.habitId === habitId && completionKey(c) === dateKey);
}

function newCompletion(habitId: string, dateKey: string): HabitCompletion {
  return { id: tempId(), habitId, date: new Date(`${dateKey}T00:00:00.000Z`), createdAt: new Date() };
}

function repeatRuleOf(t: RawTask): TaskRepeatRule | null {
  if (!t.repeatFrequency) return null;
  return {
    frequency: t.repeatFrequency,
    interval: t.repeatInterval ?? 1,
    daysOfWeek: t.repeatDaysOfWeek,
    monthlyMode: t.repeatMonthlyMode ?? "DATE",
    dayOfMonth: t.repeatDayOfMonth,
    monthlyOrdinal: t.repeatMonthlyOrdinal,
    monthlyWeekday: t.repeatMonthlyWeekday,
  };
}

// Completing (isCompleted = current state false) or un-completing a task — a repeating task rolls
// its due date forward instead of completing, mirroring api.ts's toggleTaskCompletion.
function toggledTask<T extends RawTask>(t: T, isCompleted: boolean): T {
  if (isCompleted) return { ...t, isCompleted: false, completedAt: null };
  const rule = repeatRuleOf(t);
  if (rule && t.dueDate) {
    const next = nextOccurrence(new Date(t.dueDate), rule);
    // End the series once the next occurrence would land past the repeat-until date.
    if (t.repeatUntil && utcCalendarDay(next) > utcCalendarDay(new Date(t.repeatUntil))) {
      return { ...t, isCompleted: true, completedAt: new Date() };
    }
    return { ...t, dueDate: next, isCompleted: false, notifiedAt: null };
  }
  return { ...t, isCompleted: true, completedAt: new Date() };
}

function repeatFields(repeat: TaskRepeatInput) {
  return repeat
    ? { ...resolveTaskRepeat(repeat), repeatUntil: repeat.repeatUntil ? combineDueDateTime(repeat.repeatUntil) : null }
    : NO_REPEAT;
}

// Patches a task wherever it lives — as a top-level row or inside a parent's subtasks
// (subtasks are toggleable/deletable from the expanded row UI).
function mapTask(tasks: RawTask[], id: string, fn: (t: RawTask) => RawTask): RawTask[] {
  return tasks.map((t) => {
    if (t.id === id) return fn(t);
    if (t.subtasks.some((s) => s.id === id)) {
      return { ...t, subtasks: t.subtasks.map((s) => (s.id === id ? (fn({ ...s, subtasks: [] } as RawTask) as RawTask) : s)) };
    }
    return t;
  });
}

function removeTaskById(tasks: RawTask[], id: string): RawTask[] {
  return tasks
    .filter((t) => t.id !== id)
    .map((t) => (t.subtasks.some((s) => s.id === id) ? { ...t, subtasks: t.subtasks.filter((s) => s.id !== id) } : t));
}

// Swaps a create's temp id for the server-assigned real one, wherever the row lives.
function swapTaskId(r: RawState, temp: string, real: string): RawState {
  return {
    ...r,
    tasks: r.tasks.map((t) => {
      if (t.id === temp) return { ...t, id: real };
      if (t.subtasks.some((s) => s.id === temp)) {
        return { ...t, subtasks: t.subtasks.map((s) => (s.id === temp ? { ...s, id: real } : s)) };
      }
      return t;
    }),
  };
}

// --- FormData builders (the server actions still read FormData) ---

function repeatToFd(fd: FormData, repeat: TaskRepeatInput) {
  if (!repeat) return;
  fd.set("repeatFrequency", repeat.frequency);
  fd.set("repeatInterval", String(repeat.interval ?? 1));
  fd.set("repeatMonthlyMode", repeat.monthlyMode ?? "DATE");
  if (repeat.dayOfMonth != null) fd.set("repeatDayOfMonth", String(repeat.dayOfMonth));
  if (repeat.monthlyOrdinal != null) fd.set("repeatMonthlyOrdinal", String(repeat.monthlyOrdinal));
  if (repeat.monthlyWeekday != null) fd.set("repeatMonthlyWeekday", String(repeat.monthlyWeekday));
  if (repeat.repeatUntil) fd.set("repeatUntil", repeat.repeatUntil);
  for (const d of repeat.daysOfWeek ?? []) fd.append("repeatDaysOfWeek", String(d));
}

function routineToFd(input: RoutineInput): FormData {
  const fd = new FormData();
  fd.set("title", input.title);
  fd.set("reminderTime", input.reminderTime);
  if (input.durationMinutes != null) fd.set("duration", String(input.durationMinutes));
  fd.set("frequency", input.frequency);
  fd.set("interval", String(input.interval));
  fd.set("monthlyMode", input.monthlyMode);
  if (input.dayOfMonth != null) fd.set("dayOfMonth", String(input.dayOfMonth));
  if (input.monthlyOrdinal != null) fd.set("monthlyOrdinal", String(input.monthlyOrdinal));
  if (input.monthlyWeekday != null) fd.set("monthlyWeekday", String(input.monthlyWeekday));
  for (const d of input.daysOfWeek) fd.append("daysOfWeek", String(d));
  return fd;
}

// --- Outbox action registry ---
//
// Ops persist across reloads as {action, args}; this maps the name back to the server action
// (and, for creates, the id-swap patch to run when the real id comes back).

type ActionFn = (...args: never[]) => Promise<unknown>;
type RegistryEntry = {
  fn: ActionFn;
  swap?: (r: RawState, temp: string, real: string) => RawState;
};

const REGISTRY: Record<string, RegistryEntry> = {
  addTask: { fn: serverActions.addTask, swap: swapTaskId },
  toggleTask: { fn: serverActions.toggleTask },
  removeTask: { fn: serverActions.removeTask },
  renameTask: { fn: serverActions.renameTask },
  setTaskDescription: { fn: serverActions.updateTaskDescription },
  setTaskCategory: { fn: serverActions.updateTaskCategory },
  setTaskProject: { fn: serverActions.updateTaskProject },
  setTaskDue: { fn: serverActions.updateTaskDueDate },
  setTaskRepeat: { fn: serverActions.updateTaskRepeat },
  setTaskPause: { fn: serverActions.updateTaskPause },
  setTaskSection: { fn: serverActions.updateTaskSection },
  setTaskReminderLead: { fn: serverActions.updateTaskReminderLead },
  setTaskDuration: { fn: serverActions.updateTaskDuration },
  setTaskBlock: { fn: serverActions.updateTaskBlock },
  reorderGroup: { fn: serverActions.reorderTaskGroup },
  addProject: {
    fn: serverActions.addProject,
    swap: (r, temp, real) => ({
      ...r,
      projects: r.projects.map((p) => (p.id === temp ? { ...p, id: real } : p)),
      notes: r.notes.map((n) => (n.projectId === temp ? { ...n, projectId: real } : n)),
    }),
  },
  editProject: { fn: serverActions.editProject },
  renameProject: { fn: serverActions.renameProject },
  setProjectDescription: { fn: serverActions.updateProjectDescription },
  setProjectDueDate: { fn: serverActions.updateProjectDueDate },
  toggleProject: { fn: serverActions.toggleProject },
  setProjectSections: { fn: serverActions.updateProjectSections },
  removeProject: { fn: serverActions.removeProject },
  addNote: { fn: serverActions.addNote },
  renameNote: { fn: serverActions.renameNote },
  setNoteBody: { fn: serverActions.updateNoteBody },
  setNoteProject: { fn: serverActions.updateNoteProject },
  removeNote: { fn: serverActions.removeNote },
  unlinkTask: { fn: serverActions.unlinkTask },
  addCountdown: {
    fn: serverActions.addCountdown,
    swap: (r, temp, real) => ({ ...r, countdowns: r.countdowns.map((c) => (c.id === temp ? { ...c, id: real } : c)) }),
  },
  editCountdown: { fn: serverActions.editCountdown },
  removeCountdown: { fn: serverActions.removeCountdown },
  addHabit: {
    fn: serverActions.addHabit,
    swap: (r, temp, real) => ({
      ...r,
      habits: r.habits.map((h) => (h.id === temp ? { ...h, id: real } : h)),
      habitCompletions: r.habitCompletions.map((c) => (c.habitId === temp ? { ...c, habitId: real } : c)),
    }),
  },
  editHabit: { fn: serverActions.editHabit },
  markHabitDone: { fn: serverActions.markHabitDone },
  toggleHabitCompletion: { fn: serverActions.toggleHabitCompletion },
  setHabitPause: { fn: serverActions.updateHabitPause },
  removeHabit: { fn: serverActions.removeHabit },
  addRoutine: {
    fn: serverActions.addRoutine,
    swap: (r, temp, real) => ({ ...r, routines: r.routines.map((rt) => (rt.id === temp ? { ...rt, id: real } : rt)) }),
  },
  editRoutine: { fn: serverActions.editRoutine },
  addSubroutine: {
    fn: serverActions.addSubroutine,
    swap: (r, temp, real) => ({
      ...r,
      routines: r.routines.map((rt) =>
        rt.subroutines.some((s) => s.id === temp)
          ? { ...rt, subroutines: rt.subroutines.map((s) => (s.id === temp ? { ...s, id: real } : s)) }
          : rt
      ),
    }),
  },
  tickRoutine: { fn: serverActions.tickRoutine },
  untickRoutine: { fn: serverActions.untickRoutine },
  setRoutinePause: { fn: serverActions.updateRoutinePause },
  removeRoutine: { fn: serverActions.removeRoutine },
  addCategory: {
    fn: serverActions.addCategory,
    swap: (r, temp, real) => ({ ...r, categories: r.categories.map((c) => (c.id === temp ? { ...c, id: real } : c)) }),
  },
  renameCategory: { fn: serverActions.renameCategory },
  setCategoryScope: { fn: serverActions.setCategoryScope },
  removeCategory: { fn: serverActions.removeCategory },
  addDayPlanBlock: {
    fn: serverActions.addDayPlanBlock,
    swap: (r, temp, real) => ({ ...r, dayPlanBlocks: r.dayPlanBlocks.map((b) => (b.id === temp ? { ...b, id: real } : b)) }),
  },
  updateDayPlanBlock: { fn: serverActions.editDayPlanBlock },
  removeDayPlanBlock: { fn: serverActions.removeDayPlanBlock },
  acceptSuggestion: { fn: serverActions.acceptSuggestion, swap: swapTaskId },
  snoozeSuggestion: { fn: serverActions.snoozeSuggestion },
  dismissSuggestion: { fn: serverActions.dismissSuggestion },
  addAiNote: {
    fn: serverActions.addAiNote,
    swap: (r, temp, real) => ({ ...r, aiNotes: r.aiNotes.map((n) => (n.id === temp ? { ...n, id: real } : n)) }),
  },
  removeAiNote: { fn: serverActions.removeAiNote },
  dismissCapture: { fn: serverActions.dismissCapture },
  setTimeZone: { fn: serverActions.updateTimeZone },
  dismissEvent: { fn: serverActions.dismissCalendarEvent },
  restoreEvent: { fn: serverActions.restoreCalendarEvent },
};

// `renderedAt` is the server's `nowMs` from the render this snapshot was taken against, or the
// server time of the last sync that confirmed its rows — a *server* clock reading either way, so
// it's comparable with a later render's `nowMs`. `savedAt` is the
// local clock and is kept for diagnostics only: comparing it against `nowMs` would pit this
// browser's clock against Vercel's, and a device running even slightly fast would then prefer
// its own stale snapshot over fresh server data on every load. (Start-up's cached-shell check
// does compare the local clock with `nowMs`, but only against a wide margin — CACHED_SHELL_AGE_MS.)
type Snapshot = {
  raw: RawState;
  calendarEvents: CalendarEvent[];
  savedAt: number;
  renderedAt?: number;
  // The server fingerprint this snapshot's rows came from, so a cached-shell start can ask
  // "has anything changed since?" without pulling a full render first.
  stateVersion?: string;
};

export function StoreProvider({
  initialRaw,
  serverData,
  nowMs,
  stateVersion,
  children,
}: {
  initialRaw: RawState;
  serverData: ServerCalendarData;
  nowMs: number;
  stateVersion: string;
  children: React.ReactNode;
}) {
  const [raw, setRaw] = useState(initialRaw);
  // False until the device's own snapshot has been read (or ruled out). Until then the provider
  // draws the static app frame instead of its children: the rows in the page HTML may be from a
  // cached shell days old, and the layout can't know phone from desktop before the client runs,
  // so painting either would only be replaced a moment later. One paint, from the best rows.
  const [ready, setReady] = useState(false);
  // Counts local edits to `raw`, so a sync that was in flight while one landed knows not to
  // overwrite it with server rows that predate it. Bumped by the effect below for every change
  // except the ones a sync itself applies (flagged through `applyingPullRef`).
  const editSeqRef = useRef(0);
  const applyingPullRef = useRef(false);
  useEffect(() => {
    if (applyingPullRef.current) applyingPullRef.current = false;
    else editSeqRef.current += 1;
  }, [raw]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarErrors, setCalendarErrors] = useState<string[]>([]);
  // Gates the IndexedDB snapshot write below: until the calendar lands, `events` is empty, and
  // snapshotting that would blank out the perfectly good event list already on disk.
  const [calendarSettled, setCalendarSettled] = useState(false);
  // Undo-capture reads the current row without making `actions` depend on (and rebuild with)
  // every raw change. Updated in an effect (not during render) per react-hooks/refs; handlers
  // only run after effects, so they always see the latest value.
  const rawRef = useRef(raw);
  useEffect(() => {
    rawRef.current = raw;
  }, [raw]);
  const [offline, setOffline] = useState(false);
  const [pendingOps, setPendingOps] = useState(0);
  // Server fingerprint of the rows currently on screen — see `pull` below. Held in a ref (not
  // state) because only the sync logic reads it, and it must never trigger a re-render.
  const stateVersionRef = useRef(stateVersion);
  useEffect(() => {
    stateVersionRef.current = stateVersion;
  }, [stateVersion]);
  // Server clock reading for the rows on screen: the page render's `nowMs`, then the time of the
  // last sync that confirmed or replaced them. Persisted with the IndexedDB snapshot as
  // `renderedAt` (see Snapshot).
  const renderedAtRef = useRef(nowMs);
  useEffect(() => {
    renderedAtRef.current = nowMs;
  }, [nowMs]);
  // The cron heartbeat, refreshed by version checks that skip the full render (null until one
  // reports in — until then the server render's own value stands).
  const [cronAtMs, setCronAtMs] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Live clock: re-derives buckets/labels once a minute so a tab left open overnight rolls
  // "Today" forward instead of freezing at the last server render's timestamp.
  const [liveNowMs, setLiveNowMs] = useState(nowMs);
  const [seededNow, setSeededNow] = useState(nowMs);
  if (nowMs !== seededNow) {
    setSeededNow(nowMs);
    setLiveNowMs(nowMs);
  }
  useEffect(() => {
    const timer = window.setInterval(() => setLiveNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The header's date, recomputed on the device. It used to come only from the server render, so
  // it aged with the page: a cached shell opened the next morning (or a tab left open past
  // midnight) showed yesterday. Now that a refresh is skipped whenever nothing changed, the label
  // can't depend on one happening. Seeded from the server value so the first client render still
  // matches the HTML, then re-checked on every minute tick.
  const [todayLabel, setTodayLabel] = useState(serverData.todayLabel);
  useEffect(() => {
    const label = formatLongDate(new Date());
    // The updater returns `prev` unchanged on every tick but one a day, so this is a no-op render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayLabel((prev) => (prev === label ? prev : label));
  }, [liveNowMs, serverData.todayLabel]);

  // Defaults to "all" on both server and first client render (localStorage isn't available
  // during SSR) to avoid a hydration mismatch, then syncs to the stored value right after mount.
  const [mode, setMode] = useState<Mode>("all");
  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    // One-time sync from localStorage right after mount — can't read it any earlier since SSR has no `window`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isMode(stored)) setMode(stored);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  // Re-seed from server truth when a refresh (focus/navigation) delivers a new snapshot. The
  // prop object identity only changes on an actual server render, so client-side re-renders
  // triggered by our own optimistic setRaw don't clobber local state. This is React's
  // "adjust state when a prop changes" pattern (compared during render, no effect needed).
  const [seededFrom, setSeededFrom] = useState(initialRaw);
  const [syncing, setSyncing] = useState(false);
  if (initialRaw !== seededFrom) {
    setSeededFrom(initialRaw);
    setRaw(initialRaw);
    // Events are not re-seeded here — each server render brings a *new* calendar promise, and the
    // effect keyed on that promise's identity applies it when it resolves. Re-seeding from the
    // unresolved promise would only blank the calendar until it landed.
    if (syncing) setSyncing(false);
    // A fresh server render is proof the connection is back, whatever the flag said.
    if (offline) setOffline(false);
  }

  // Pull the calendar once, after mount. Deliberately a client-side fetch rather than part of the
  // page render: the ICS feeds are the one read on this screen that leaves the datacentre, and
  // nothing above the fold needs them, so the task list should never wait on Google and Outlook.
  // Everything else about the calendar (month grid, day details) is derived client-side already,
  // so the events landing a moment later just fills the rail in.
  useEffect(() => {
    let cancelled = false;
    void serverActions
      .loadCalendarFeeds()
      .then(({ events: nextEvents, errors }) => {
        if (cancelled) return;
        setEvents(nextEvents);
        setCalendarErrors(errors);
      })
      .catch((err) => {
        console.error("[store] calendar fetch failed:", err);
        if (!cancelled) setCalendarErrors(["Could not load the calendar."]);
      })
      .finally(() => {
        // Releases the snapshot gate below whether or not the fetch worked.
        if (!cancelled) setCalendarSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Toasts -------------------------------------------------------------------------------

  const toastSeq = useRef(0);
  const pushToast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((ts) => [...ts, { id, message, actionLabel, onAction }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), UNDO_MS);
    return id;
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  // --- Outbox -------------------------------------------------------------------------------

  const flushingRef = useRef(false);
  const backoffDelayRef = useRef(30_000);
  const backoffTimerRef = useRef<number | null>(null);
  const hadFailureRef = useRef(false);
  const idMapRef = useRef<Record<string, string>>({});
  const refreshAtRef = useRef(0);

  // Bumped after every sync that reached the server, so the snapshot effect re-persists the
  // refreshed `renderedAt`/version even when the rows themselves didn't change.
  const [syncStamp, setSyncStamp] = useState(0);
  const pullingRef = useRef(false);

  // Sync with the server in one call (see `pullState` in app/actions.ts): send the fingerprint of
  // the rows on screen, get back either "unchanged" or the full rows to swap in — no page
  // re-render. Resolves true when the device is now in step with the server. A failed call
  // changes nothing: the rows on screen stay, and the next focus/poll tries again.
  const pull = useCallback(async ({ force = false }: { force?: boolean } = {}): Promise<boolean> => {
    if (pullingRef.current) return false;
    pullingRef.current = true;
    refreshAtRef.current = Date.now();
    const editSeqAtStart = editSeqRef.current;
    try {
      const result = await serverActions.pullState(force ? null : stateVersionRef.current);
      // The heartbeat is excluded from the fingerprint (it moves every minute), so it rides along
      // on every answer — otherwise an unchanged sync would age it into a false "reminders may
      // not be firing" warning.
      setCronAtMs(result.lastCronAtMs);
      setOffline(false);
      if (result.raw) {
        // A local edit made while this was in flight (or still queued for the server) isn't in
        // these rows — applying them would briefly undo it. Leave the version alone so the next
        // sync, after the edit has been sent, picks the rows up instead.
        const queued = idbAvailable() ? await outboxCount().catch(() => 1) : 0;
        if (editSeqRef.current !== editSeqAtStart || queued > 0) return false;
        applyingPullRef.current = true;
        setRaw(withRawDefaults(result.raw));
        stateVersionRef.current = result.version;
      }
      renderedAtRef.current = result.serverNowMs;
      setLiveNowMs(Date.now());
      setSyncStamp((n) => n + 1);
      return true;
    } catch (err) {
      console.error("[store] sync failed:", err);
      return false;
    } finally {
      pullingRef.current = false;
    }
  }, []);

  // The two ways the rest of the store reconciles: unconditionally (after a rejected write, or
  // a server-computed change like duplicating a project) and only-if-changed (open/focus/poll).
  const refreshNow = useCallback(() => pull({ force: true }), [pull]);
  const maybeRefresh = useCallback(() => pull(), [pull]);

  // Manual calendar pull. Deliberately NOT routed through the optimistic outbox: there's nothing
  // to patch locally, it's a read that has to hit the network, so it awaits the server and then
  // reconciles through the normal refresh path.
  const [calendarRefreshing, setCalendarRefreshing] = useState(false);
  const refreshCalendar = useCallback(async () => {
    setCalendarRefreshing(true);
    try {
      // Swap the events in directly. They no longer arrive through the page render, so the
      // router.refresh() this used to do wouldn't bring anything new back.
      const { events: nextEvents, errors } = await serverActions.refreshCalendarFeeds();
      setEvents(nextEvents);
      setCalendarErrors(errors);
      pushToast(errors.length ? errors[0] : "Calendar refreshed");
    } catch {
      pushToast("Couldn't reach the calendar feeds");
    } finally {
      setCalendarRefreshing(false);
    }
  }, [pushToast]);

  const syncPendingCount = useCallback(async () => {
    if (!idbAvailable()) return;
    try {
      setPendingOps(await outboxCount());
    } catch {
      // Counting is cosmetic — never let it break a flush.
    }
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current || !idbAvailable()) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setOffline(true);
      return;
    }
    flushingRef.current = true;
    let sawServerError = false;
    try {
      for (;;) {
        const op = await outboxPeek();
        if (!op) {
          // Nothing left to send and the browser thinks it's online — clear the banner. Without
          // this the flag only ever cleared on a *successful op*, so a device that hiccupped once
          // with an empty outbox stayed stuck on "Offline" until an actual `online` event fired
          // (which never comes if the OS never saw the connection drop).
          if (typeof navigator === "undefined" || navigator.onLine) setOffline(false);
          break;
        }
        const entry = REGISTRY[op.action];
        if (!entry) {
          // Op from an older build whose action no longer exists — drop it.
          await outboxDelete(op.seq!);
          continue;
        }
        const args = remapArgIds(op.args, idMapRef.current).map(deserializeArg);
        try {
          const result = await (entry.fn as (...a: unknown[]) => Promise<unknown>)(...args);
          if (op.tempId && typeof result === "string") {
            idMapRef.current[op.tempId] = result;
            await kvSet(IDMAP_KEY, idMapRef.current);
            const swap = entry.swap;
            if (swap) setRaw((r) => swap(r, op.tempId!, result));
          }
          await outboxDelete(op.seq!);
          backoffDelayRef.current = 30_000;
          setOffline(false);
        } catch (err) {
          if (isNetworkError(err)) {
            // A failure that only *looks* like a network error — the classic one is a tab left
            // open across a deploy, where every server action 404s on a build id that no longer
            // exists — never resolves by waiting. Retrying it forever keeps the outbox non-empty,
            // and a non-empty outbox stops this device reconciling with the server at all. Cap
            // the retries so it degrades into a normal rejection instead.
            const attempts = await outboxBumpAttempts(op).catch(() => 0);
            if (attempts >= MAX_OP_ATTEMPTS) {
              console.error(`[store] giving up on queued ${op.action} after ${attempts} attempts:`, err);
              pushToast("A change couldn't be saved and was rolled back.");
              await outboxDelete(op.seq!);
              sawServerError = true;
              continue;
            }
            // Leave the op queued; retry on the backoff schedule (capped, page-open only) or
            // when an online/visibility event arrives — whichever comes first.
            setOffline(true);
            hadFailureRef.current = true;
            if (backoffTimerRef.current) window.clearTimeout(backoffTimerRef.current);
            backoffTimerRef.current = window.setTimeout(() => {
              backoffTimerRef.current = null;
              void flushRef.current();
            }, backoffDelayRef.current);
            backoffDelayRef.current = Math.min(backoffDelayRef.current * 4, 15 * 60_000);
            break;
          }
          // The server rejected it — drop the op, tell the user, reconcile with server truth.
          console.error(`[store] server rejected queued ${op.action}:`, err);
          pushToast("A change couldn't be saved and was rolled back.");
          await outboxDelete(op.seq!);
          sawServerError = true;
        }
      }
    } finally {
      flushingRef.current = false;
      await syncPendingCount();
    }
    const drained = (await outboxCount().catch(() => 1)) === 0;
    if (drained && (sawServerError || hadFailureRef.current)) {
      // Reconcile once after recovering from an offline stretch or a rejected op.
      hadFailureRef.current = false;
      void refreshNow();
    }
  }, [pushToast, refreshNow, syncPendingCount]);

  // The backoff timer captures flush across renders via a ref to avoid stale closures.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Manual refresh (the header's ⟳). Rolls the clock forward so date labels/buckets are right
  // straight away, drains anything still queued, then pulls the server's rows — the same
  // reconcile the focus handler does, but on demand: on a phone the tab is often restored from
  // the background without a focus refresh landing promptly, leaving stale rows on screen. The
  // spinner clears when the sync settles, with a timeout so one that never comes back can't
  // leave it spinning forever.
  const syncTimeoutRef = useRef<number | null>(null);
  const syncNow = useCallback(() => {
    setSyncing(true);
    setLiveNowMs(Date.now());
    if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = window.setTimeout(() => {
      syncTimeoutRef.current = null;
      setSyncing(false);
    }, 15_000);
    void flushRef.current()
      .then(() => refreshNow())
      .finally(() => {
        if (syncTimeoutRef.current) window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
        setSyncing(false);
      });
  }, [refreshNow]);

  // Enqueue + immediately try to flush. Falls back to a direct call when IndexedDB is
  // unavailable (very old browser / blocked storage) — the pre-outbox behavior.
  const enqueue = useCallback(
    (action: string, rawArgs: (string | number | boolean | FormData)[], tempIdForCreate?: string) => {
      if (!idbAvailable()) {
        const entry = REGISTRY[action];
        void (entry.fn as (...a: unknown[]) => Promise<unknown>)(...rawArgs)
          .then((result) => {
            if (tempIdForCreate && typeof result === "string" && entry.swap) {
              setRaw((r) => entry.swap!(r, tempIdForCreate, result));
            }
          })
          .catch((err) => {
            console.error(`[store] ${action} failed, refreshing:`, err);
            void refreshNow();
          });
        return;
      }
      const args: SerializedArg[] = rawArgs.map(serializeArg);
      void outboxAdd({ action, args, tempId: tempIdForCreate })
        .then(() => {
          void syncPendingCount();
          void flushRef.current();
        })
        .catch((err) => {
          // IndexedDB write failed — degrade to a direct call rather than losing the edit.
          console.error("[store] outbox write failed, sending directly:", err);
          void (REGISTRY[action].fn as (...a: unknown[]) => Promise<unknown>)(...rawArgs).catch((e) => {
            console.error(`[store] ${action} failed, refreshing:`, e);
            void refreshNow();
          });
        });
    },
    [refreshNow, syncPendingCount]
  );

  // --- Persistence & lifecycle ---------------------------------------------------------------

  // Register the service worker on every load (used to happen only when Settings was opened,
  // which meant a device that never visited Settings had no offline shell and no push).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => console.error("[sw] register failed:", err));

    // Navigations are served from cache first (see sw.js), so this page may be running a shell
    // from an older deploy. The worker's background revalidate posts this once it notices a new
    // build; reloading now picks it up, and the shell it reloads onto is already cached, so the
    // reload is near-instant. Held back while ops are queued — a reload mid-flush would drop the
    // optimistic rows that only exist in memory.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "cura-shell-updated") return;
      void outboxCount()
        .catch(() => 1)
        .then((queued) => {
          if (queued === 0) window.location.reload();
        });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Start-up: pick the rows to draw first, then reveal the app (see `ready`). One-shot, on mount.
  //
  // The device's snapshot wins whenever the page HTML can't be trusted to be newer: when the
  // service worker answered from its cache (the usual case once installed — see sw.js), when ops
  // are still queued (their optimistic rows only live in the snapshot), or when offline. A page
  // that really did just come from the network is fresher than anything on disk and is kept.
  // Either way the app paints once; a sync then runs in the background and patches the rows in
  // place if anything changed elsewhere.
  useEffect(() => {
    // The clock was seeded from the page render, which for a cached shell can be yesterday's —
    // until the first one-minute tick, tasks would bucket into "Today"/"Overdue" against it.
    // One-time sync from the device clock after mount — it can't be read during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLiveNowMs(Date.now());
    if (!idbAvailable()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    let revealed = false;
    const reveal = () => {
      if (revealed || cancelled) return;
      revealed = true;
      setReady(true);
    };
    const giveUp = window.setTimeout(reveal, HYDRATE_TIMEOUT_MS);
    void (async () => {
      try {
        const [snapshot, idMap, queued] = await Promise.all([
          kvGet<Snapshot>(SNAPSHOT_KEY),
          kvGet<Record<string, string>>(IDMAP_KEY),
          outboxCount(),
        ]);
        if (cancelled) return;
        if (idMap) idMapRef.current = idMap;
        setPendingOps(queued);
        const offlineNow = typeof navigator !== "undefined" && !navigator.onLine;
        // Server-clock vs server-clock where possible: a snapshot taken against this render or a
        // later sync is at least as fresh as it. Otherwise fall back on the shell's age.
        const snapshotIsNewer = snapshot?.renderedAt !== undefined && snapshot.renderedAt >= nowMs;
        const shellFromCache = Date.now() - nowMs > CACHED_SHELL_AGE_MS;
        // Too late to swap rows in without the very flash this is here to prevent — unless
        // queued ops make the snapshot the only copy of some edits.
        const useSnapshot =
          !!snapshot && (snapshotIsNewer || shellFromCache || queued > 0 || offlineNow) && (!revealed || queued > 0);
        if (snapshot && useSnapshot) {
          setRaw(withRawDefaults(snapshot.raw));
          if (snapshot.calendarEvents?.length) setEvents(snapshot.calendarEvents);
          // The rows on screen are now the snapshot's, so the version to compare against is the
          // snapshot's too — the cached shell's own fingerprint is from whenever it was cached,
          // which can be older still.
          if (snapshot.stateVersion) stateVersionRef.current = snapshot.stateVersion;
          if (snapshot.renderedAt !== undefined) renderedAtRef.current = snapshot.renderedAt;
        }
        if (offlineNow) setOffline(true);
        if (queued > 0) {
          // Sync once the queue has drained (see the end of `flush`) — a pull now would be
          // refused anyway while ops are queued.
          hadFailureRef.current = true;
          void flushRef.current();
        } else if (!offlineNow && (useSnapshot || shellFromCache || revealed)) {
          // Whatever is on screen came from disk or a cached shell — check it against the server.
          // (A page that just came from the network is current; it needs no check.)
          void maybeRefresh();
        }
      } catch (err) {
        console.error("[store] snapshot hydration failed:", err);
        void maybeRefresh();
      } finally {
        window.clearTimeout(giveUp);
        reveal();
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot the raw state (debounced) so the next start has data to render. Held until the
  // calendar has settled: writing before that would persist an empty event list over the good
  // one already stored, and a cached-shell start would then come up with no calendar at all.
  useEffect(() => {
    // Also held until start-up has picked its rows: before that `raw` may still be a cached
    // shell's, and writing it would overwrite the newer snapshot it's about to be replaced by.
    if (!idbAvailable() || !calendarSettled || !ready) return;
    const timer = window.setTimeout(() => {
      void kvSet(SNAPSHOT_KEY, {
        raw,
        calendarEvents: events,
        savedAt: Date.now(),
        renderedAt: renderedAtRef.current,
        stateVersion: stateVersionRef.current,
      } satisfies Snapshot).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
    // `syncStamp`: a sync that confirmed the rows still moves `renderedAt` forward.
  }, [raw, events, calendarSettled, ready, syncStamp]);

  // Reconcile with the server when the tab regains focus (covers optimistic drift, other
  // devices, and voice captures landing while away). Debounced: focus + visibilitychange fire
  // together, and each refresh is a full server render. Skipped while ops are queued — the
  // server snapshot would clobber optimistic rows; the post-drain refresh covers it instead.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== "visible") return;
      void flushRef.current();
      if (Date.now() - refreshAtRef.current < REFRESH_DEBOUNCE_MS) return;
      void outboxCount()
        .catch(() => 0)
        .then((queued) => {
          if (queued === 0) void maybeRefresh();
        });
    };
    const onOnline = () => {
      setOffline(false);
      backoffDelayRef.current = 30_000;
      void flushRef.current();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [maybeRefresh]);

  // Poll for other devices' changes while the tab is actually being looked at. Deliberately
  // *only* while visible: a backgrounded tab has no one to show a change to, and the focus
  // handler above already covers coming back to it.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - refreshAtRef.current < REFRESH_DEBOUNCE_MS) return;
      void outboxCount()
        .catch(() => 0)
        .then((queued) => {
          // Queued ops mean local rows the server doesn't have yet — reconciling now would
          // clobber them, exactly as in the focus handler.
          if (queued === 0) void maybeRefresh();
        });
    }, VERSION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [maybeRefresh]);

  // --- Notes ↔ tasks ---------------------------------------------------------------------------

  // The open note's editor holds text the store hasn't seen yet (it saves on a debounce), so an
  // edit to a note made from elsewhere — ticking its task in the side panel, renaming the task —
  // has to reach the editor directly rather than through raw state, or the editor's next save
  // would write the old line back. NotePage registers here while a note is open.
  const noteEditListenersRef = useRef(new Map<string, (transform: (body: string) => string) => void>());
  const subscribeNoteEdits = useCallback((noteId: string, fn: (transform: (body: string) => string) => void) => {
    noteEditListenersRef.current.set(noteId, fn);
    return () => {
      if (noteEditListenersRef.current.get(noteId) === fn) noteEditListenersRef.current.delete(noteId);
    };
  }, []);

  // Applies a line edit to a note locally — never queued: every caller's own server write makes the
  // same edit to the stored note (see api.ts's editTaskNoteLine).
  const editNoteBody = useCallback((noteId: string, transform: (body: string) => string) => {
    noteEditListenersRef.current.get(noteId)?.(transform);
    setRaw((r) => ({ ...r, notes: r.notes.map((n) => (n.id === noteId ? { ...n, body: transform(n.body) } : n)) }));
  }, []);

  // Tasks whose checkbox line was removed from their note, waiting out the warning toast before
  // they're deleted. Keyed by task id; the line coming back (undo, paste) cancels the delete.
  const pendingOrphansRef = useRef(new Map<string, { timer: number; toastId: number }>());

  // Every task whose checkbox line has gone from its note — deleted in Cura's editor, or in
  // Obsidian and synced up through the vault bridge (the server never deletes these itself) —
  // gets a warning toast and is deleted when it closes, unless "Keep task" is pressed (the task
  // carries on unlinked) or the line comes back first (an undo, a paste, Obsidian's undo).
  useEffect(() => {
    const bodies = new Map(raw.notes.map((n) => [n.id, n.body]));
    const pending = pendingOrphansRef.current;
    const orphanIds = new Set<string>();
    for (const t of raw.tasks) {
      if (!t.noteId || !t.noteBlockId) continue;
      const body = bodies.get(t.noteId);
      if (body === undefined || bodyHasBlock(body, t.noteBlockId)) continue;
      orphanIds.add(t.id);
      if (pending.has(t.id)) continue;
      const taskId = t.id;
      const timer = window.setTimeout(() => {
        pending.delete(taskId);
        setRaw((r) => ({ ...r, tasks: removeTaskById(r.tasks, taskId) }));
        enqueue("removeTask", [taskId]);
      }, UNDO_MS);
      const toastId = pushToast(`"${t.title}" left its note, so its task will be deleted`, "Keep task", () => {
        window.clearTimeout(timer);
        pending.delete(taskId);
        setRaw((r) => ({ ...r, tasks: mapTask(r.tasks, taskId, (x) => ({ ...x, noteId: null, noteBlockId: null })) }));
        enqueue("unlinkTask", [taskId]);
      });
      pending.set(taskId, { timer, toastId });
    }
    for (const [taskId, p] of pending) {
      if (orphanIds.has(taskId)) continue;
      window.clearTimeout(p.timer);
      setToasts((ts) => ts.filter((t) => t.id !== p.toastId));
      pending.delete(taskId);
    }
  }, [raw.notes, raw.tasks, enqueue, pushToast]);

  // --- Undoable deletes -----------------------------------------------------------------------

  // The row leaves the UI immediately; the server delete is enqueued only after the undo
  // window closes. Undo restores the captured row — nothing was ever sent, so nothing can be
  // half-deleted. If the tab dies inside the window the delete never happens (the item
  // reappears on next load — the safe failure direction).
  const deleteWithUndo = useCallback(
    (label: string, patchOut: (r: RawState) => RawState, restore: (r: RawState) => RawState, sendDelete: () => void) => {
      setRaw(patchOut);
      let undone = false;
      const timer = window.setTimeout(() => {
        if (!undone) sendDelete();
      }, UNDO_MS);
      pushToast(`${label} deleted`, "Undo", () => {
        undone = true;
        window.clearTimeout(timer);
        setRaw(restore);
      });
    },
    [pushToast]
  );

  // Every dependency here is a stable callback, so these are built once and reused.
  const actions = useMemo<TaskbookActions>(() => {
    const mutate = (patch: (r: RawState) => RawState, action: string, args: (string | number | boolean | FormData)[]) => {
      setRaw(patch);
      enqueue(action, args);
    };

    const create = (patch: (r: RawState) => RawState, action: string, args: (string | number | boolean | FormData)[], id: string) => {
      setRaw(patch);
      enqueue(action, args, id);
    };

    return {
      // --- Tasks ---
      addTask: (input) => {
        const id = tempId();
        const now = new Date();
        const due = input.dueDate ? combineDueDateTime(input.dueDate, input.dueTime) : null;
        const row: RawTask = {
          id,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          category: input.category.trim(),
          dueDate: due,
          isCompleted: false,
          completedAt: null,
          createdAt: now,
          notifiedAt: null,
          projectId: input.projectId || null,
          parentId: input.parentId || null,
          section: input.section?.trim() || null,
          sortOrder: null,
          reminderLeadMinutes: input.reminderLeadMinutes ?? null,
          durationMinutes: input.durationMinutes ?? null,
          blockedReason: null,
          blockedUntil: null,
          noteId: null,
          noteBlockId: null,
          pausedUntil: null,
          subtasks: [],
          ...repeatFields(input.repeat ?? null),
        };
        const fd = new FormData();
        fd.set("title", row.title);
        fd.set("category", row.category);
        if (row.description) fd.set("description", row.description);
        if (input.dueDate) fd.set("dueDate", input.dueDate);
        if (input.dueTime) fd.set("dueTime", input.dueTime);
        if (row.projectId) fd.set("projectId", row.projectId);
        if (row.parentId) fd.set("parentId", row.parentId);
        if (row.section) fd.set("section", row.section);
        if (row.reminderLeadMinutes) fd.set("reminderLeadMinutes", String(row.reminderLeadMinutes));
        if (row.durationMinutes) fd.set("duration", String(row.durationMinutes));
        repeatToFd(fd, input.repeat ?? null);
        create(
          (r) =>
            row.parentId
              ? { ...r, tasks: mapTask(r.tasks, row.parentId, (p) => ({ ...p, subtasks: [...p.subtasks, row] })) }
              : { ...r, tasks: [...r.tasks, row] },
          "addTask",
          [fd],
          id
        );
      },
      toggleTask: (id, isCompleted) => {
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => toggledTask(t, isCompleted)) }), "toggleTask", [id, isCompleted]);
        // A task from a note ticks its checkbox line too (the server does the same on its side).
        const row = rawRef.current.tasks.find((t) => t.id === id);
        if (row?.noteId && row.noteBlockId) {
          const done = toggledTask(row, isCompleted).isCompleted;
          editNoteBody(row.noteId, (body) => setBlockChecked(body, row.noteBlockId!, done));
        }
      },
      removeTask: (id) => {
        let captured: { row: RawTask; parentId: string | null } | null = null;
        for (const t of rawRef.current.tasks) {
          if (t.id === id) captured = { row: t, parentId: null };
          const sub = t.subtasks.find((s) => s.id === id);
          if (sub) captured = { row: { ...sub, subtasks: [] }, parentId: t.id };
        }
        if (!captured) return;
        const { row, parentId } = captured;
        deleteWithUndo(
          "Task",
          (r) => ({ ...r, tasks: removeTaskById(r.tasks, id) }),
          (r) =>
            parentId
              ? { ...r, tasks: mapTask(r.tasks, parentId, (p) => ({ ...p, subtasks: [...p.subtasks, row] })) }
              : { ...r, tasks: [...r.tasks, row] },
          () => {
            // A task from a note takes its line with it — once the undo window has passed.
            if (row.noteId && row.noteBlockId) editNoteBody(row.noteId, (body) => removeBlockLine(body, row.noteBlockId!));
            enqueue("removeTask", [id]);
          }
        );
      },
      renameTask: (id, title) => {
        const fd = new FormData();
        fd.set("title", title);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, title })) }), "renameTask", [id, fd]);
        const row = rawRef.current.tasks.find((t) => t.id === id);
        if (row?.noteId && row.noteBlockId) editNoteBody(row.noteId, (body) => setBlockTitle(body, row.noteBlockId!, title));
      },
      setTaskDescription: (id, description) => {
        const fd = new FormData();
        fd.set("description", description);
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, description: description || null })) }),
          "setTaskDescription",
          [id, fd]
        );
      },
      setTaskCategory: (id, category) => {
        const fd = new FormData();
        fd.set("category", category);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, category })) }), "setTaskCategory", [id, fd]);
      },
      setTaskProject: (id, projectId) => {
        const fd = new FormData();
        fd.set("projectId", projectId);
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, projectId: projectId || null })) }),
          "setTaskProject",
          [id, fd]
        );
      },
      setTaskDue: (id, dueDate, dueTime) => {
        const fd = new FormData();
        fd.set("dueDate", dueDate);
        fd.set("dueTime", dueTime);
        mutate(
          (r) => ({
            ...r,
            tasks: mapTask(r.tasks, id, (t) => ({
              ...t,
              dueDate: dueDate ? combineDueDateTime(dueDate, dueTime) : null,
              notifiedAt: null,
            })),
          }),
          "setTaskDue",
          [id, fd]
        );
      },
      setTaskRepeat: (id, repeat) => {
        const fd = new FormData();
        repeatToFd(fd, repeat);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, ...repeatFields(repeat) })) }), "setTaskRepeat", [id, fd]);
      },
      setTaskPause: (id, pausedUntil) => {
        const fd = new FormData();
        fd.set("pausedUntil", pausedUntil);
        mutate(
          (r) => ({
            ...r,
            tasks: mapTask(r.tasks, id, (t) => ({ ...t, pausedUntil: pausedUntil ? combineDueDateTime(pausedUntil) : null })),
          }),
          "setTaskPause",
          [id, fd]
        );
      },
      setTaskSection: (id, section) => {
        const fd = new FormData();
        fd.set("section", section);
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, section: section.trim() || null })) }),
          "setTaskSection",
          [id, fd]
        );
      },
      setTaskReminderLead: (id, minutes) => {
        const fd = new FormData();
        fd.set("reminderLeadMinutes", minutes ? String(minutes) : "");
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, reminderLeadMinutes: minutes })) }),
          "setTaskReminderLead",
          [id, fd]
        );
      },
      setTaskDuration: (id, minutes) => {
        const fd = new FormData();
        fd.set("duration", minutes ? String(minutes) : "");
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, durationMinutes: minutes })) }),
          "setTaskDuration",
          [id, fd]
        );
      },
      setTaskBlock: (id, reason, untilDate) => {
        const fd = new FormData();
        fd.set("blockedReason", reason);
        fd.set("blockedUntil", untilDate);
        const cleared = !reason.trim();
        mutate(
          (r) => ({
            ...r,
            tasks: mapTask(r.tasks, id, (t) => ({
              ...t,
              blockedReason: cleared ? null : reason.trim(),
              blockedUntil: cleared || !/^\d{4}-\d{2}-\d{2}$/.test(untilDate) ? null : combineDueDateTime(untilDate),
            })),
          }),
          "setTaskBlock",
          [id, fd]
        );
      },
      reorderGroup: (orderedIds) => {
        const orderById = new Map(orderedIds.map((id, i) => [id, (i + 1) * 1024]));
        const fd = new FormData();
        for (const id of orderedIds) fd.append("ids", id);
        mutate(
          (r) => ({
            ...r,
            tasks: r.tasks.map((t) => (orderById.has(t.id) ? { ...t, sortOrder: orderById.get(t.id)! } : t)),
          }),
          "reorderGroup",
          [fd]
        );
      },

      // --- Projects ---
      addProject: (input) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("name", input.name);
        if (input.description) fd.set("description", input.description);
        if (input.dueDate) fd.set("dueDate", input.dueDate);
        if (input.reminderLeadMinutes) fd.set("reminderLeadMinutes", String(input.reminderLeadMinutes));
        if (input.durationMinutes) fd.set("duration", String(input.durationMinutes));
        create(
          (r) => ({
            ...r,
            projects: [
              ...r.projects,
              {
                id,
                name: input.name.trim(),
                description: input.description?.trim() || null,
                isCompleted: false,
                dueDate: input.dueDate ? new Date(input.dueDate) : null,
                notifiedAt: null,
                reminderLeadMinutes: input.reminderLeadMinutes ?? null,
                durationMinutes: input.durationMinutes ?? null,
                sectionsEnabled: false,
              },
            ],
          }),
          "addProject",
          [fd],
          id
        );
        return id;
      },
      editProject: (id, input) => {
        const fd = new FormData();
        fd.set("name", input.name);
        if (input.description) fd.set("description", input.description);
        if (input.dueDate) fd.set("dueDate", input.dueDate);
        if (input.reminderLeadMinutes) fd.set("reminderLeadMinutes", String(input.reminderLeadMinutes));
        if (input.durationMinutes) fd.set("duration", String(input.durationMinutes));
        mutate(
          (r) => ({
            ...r,
            projects: r.projects.map((p) =>
              p.id === id
                ? {
                    ...p,
                    name: input.name.trim(),
                    description: input.description?.trim() || null,
                    dueDate: input.dueDate ? new Date(input.dueDate) : null,
                    reminderLeadMinutes: input.reminderLeadMinutes ?? null,
                    durationMinutes: input.durationMinutes ?? null,
                  }
                : p
            ),
          }),
          "editProject",
          [id, fd]
        );
      },
      // Server-computed copy; not optimistic (would duplicate the whole task tree client-side
      // for a rare op). Requires a connection.
      duplicateProject: (templateId, name) => {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          pushToast("Duplicating a project needs a connection.");
          return;
        }
        const fd = new FormData();
        if (name) fd.set("name", name);
        void serverActions
          .duplicateProject(templateId, fd)
          .then(() => void refreshNow())
          .catch((err) => {
            console.error("[store] duplicateProject failed:", err);
            pushToast("Couldn't duplicate the project.");
          });
      },
      renameProject: (id, name) => {
        const fd = new FormData();
        fd.set("name", name);
        mutate((r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, name } : p)) }), "renameProject", [id, fd]);
      },
      setProjectDescription: (id, description) => {
        const fd = new FormData();
        fd.set("description", description);
        mutate(
          (r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, description: description || null } : p)) }),
          "setProjectDescription",
          [id, fd]
        );
      },
      setProjectDueDate: (id, dueDate) => {
        const fd = new FormData();
        fd.set("dueDate", dueDate);
        mutate(
          (r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, dueDate: dueDate ? new Date(dueDate) : null, notifiedAt: null } : p)) }),
          "setProjectDueDate",
          [id, fd]
        );
      },
      toggleProject: (id, isCompleted) =>
        mutate(
          (r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, isCompleted: !isCompleted } : p)) }),
          "toggleProject",
          [id, isCompleted]
        ),
      // Turning sections off also clears every task's section locally, mirroring the server
      // (setProjectSections in api.ts) so the card regroups instantly.
      setProjectSections: (id, enabled) =>
        mutate(
          (r) => ({
            ...r,
            projects: r.projects.map((p) => (p.id === id ? { ...p, sectionsEnabled: enabled } : p)),
            tasks: enabled ? r.tasks : r.tasks.map((t) => (t.projectId === id && t.section ? { ...t, section: null } : t)),
          }),
          "setProjectSections",
          [id, enabled]
        ),
      removeProject: (id) => {
        const captured = rawRef.current.projects.find((p) => p.id === id);
        if (!captured) return;
        // The project's notes stay, as Unfiled (the server's onDelete: SetNull) — but only once
        // the undo window has closed, so an Undo puts them back under the project untouched.
        deleteWithUndo(
          "Project",
          (r) => ({ ...r, projects: r.projects.filter((p) => p.id !== id) }),
          (r) => ({ ...r, projects: [...r.projects, captured] }),
          () => {
            setRaw((r) => ({ ...r, notes: r.notes.map((n) => (n.projectId === id ? { ...n, projectId: null } : n)) }));
            enqueue("removeProject", [id]);
          }
        );
      },

      // --- Notes ---
      // Every edit bumps updatedAt locally so the Notes list re-sorts as the server would.
      addNote: (input) => {
        const id = crypto.randomUUID();
        const now = new Date();
        const row: Note = {
          id,
          title: input.title?.trim() || "Untitled",
          body: "",
          projectId: input.projectId || null,
          createdAt: now,
          updatedAt: now,
        };
        mutate((r) => ({ ...r, notes: [row, ...r.notes] }), "addNote", [id, row.title, row.projectId ?? ""]);
        return id;
      },
      renameNote: (id, title) => {
        const next = title.trim() || "Untitled";
        mutate(
          (r) => ({ ...r, notes: r.notes.map((n) => (n.id === id ? { ...n, title: next, updatedAt: new Date() } : n)) }),
          "renameNote",
          [id, next]
        );
      },
      saveNoteBody: (noteId, draft) => {
        const r0 = rawRef.current;
        const note = r0.notes.find((n) => n.id === noteId);
        if (!note) return draft;
        let body = assignBlockIds(draft);
        const linked = r0.tasks.filter((t) => t.noteId === noteId);
        const plan = planNoteTaskSync(body, linked);

        // New tasks get their final ids here (no temp-id swap), and the server is told them.
        const category = defaultNoteTaskCategory(
          note.projectId ? r0.tasks.filter((t) => t.projectId === note.projectId).map((t) => t.category) : [],
          r0.categories.map((c) => c.name)
        );
        const now = new Date();
        const creates: Record<string, { id: string; category: string }> = {};
        const newRows: RawTask[] = plan.creates.map((c) => {
          const id = crypto.randomUUID();
          creates[c.blockId] = { id, category };
          const row: RawTask = {
            id,
            title: c.title,
            description: null,
            category,
            dueDate: null,
            isCompleted: false,
            completedAt: null,
            createdAt: now,
            notifiedAt: null,
            projectId: note.projectId,
            parentId: null,
            section: null,
            sortOrder: null,
            reminderLeadMinutes: null,
            durationMinutes: null,
            blockedReason: null,
            blockedUntil: null,
            pausedUntil: null,
            noteId,
            noteBlockId: c.blockId,
            subtasks: [],
            ...NO_REPEAT,
          };
          return c.checked ? toggledTask(row, false) : row;
        });

        // Ticks from the note. A repeating task rolls forward instead of completing, so its box
        // is un-ticked again — mirrored server-side in saveNoteBody.
        const toggled = new Map<string, RawTask>();
        for (const t of plan.toggles) {
          const row = linked.find((l) => l.id === t.taskId);
          if (!row) continue;
          const after = toggledTask(row, t.isCompleted);
          toggled.set(row.id, after);
          if (after.isCompleted === t.isCompleted && row.noteBlockId) body = setBlockChecked(body, row.noteBlockId, after.isCompleted);
        }
        const renamed = new Map(plan.renames.map((r) => [r.taskId, r.title]));

        setRaw((r) => ({
          ...r,
          notes: r.notes.map((n) => (n.id === noteId ? { ...n, body, updatedAt: new Date() } : n)),
          tasks: [
            ...r.tasks.map((t) => {
              let next = toggled.get(t.id) ?? t;
              const title = renamed.get(t.id);
              if (title !== undefined) next = { ...next, title };
              return next;
            }),
            ...newRows,
          ],
        }));
        enqueue("setNoteBody", [noteId, body, JSON.stringify({ creates, linked: linked.length })]);

        // Lines that disappeared are picked up by the orphan watcher below the actions.
        return body;
      },
      setNoteProject: (id, projectId) =>
        mutate(
          (r) => ({
            ...r,
            notes: r.notes.map((n) => (n.id === id ? { ...n, projectId, updatedAt: new Date() } : n)),
            // The note's tasks follow it (api.ts's updateNote does the same).
            tasks: r.tasks.map((t) => (t.noteId === id ? { ...t, projectId } : t)),
          }),
          "setNoteProject",
          [id, projectId ?? ""]
        ),
      removeNote: (id) => {
        const captured = rawRef.current.notes.find((n) => n.id === id);
        if (!captured) return;
        deleteWithUndo(
          "Note",
          (r) => ({ ...r, notes: r.notes.filter((n) => n.id !== id) }),
          (r) => ({ ...r, notes: [captured, ...r.notes] }),
          () => {
            // Its tasks stay, as ordinary tasks (the server's onDelete: SetNull).
            setRaw((r) => ({ ...r, tasks: r.tasks.map((t) => (t.noteId === id ? { ...t, noteId: null, noteBlockId: null } : t)) }));
            enqueue("removeNote", [id]);
          }
        );
      },

      // --- Countdowns ---
      addCountdown: (input) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("title", input.title);
        fd.set("date", input.date);
        fd.set("repeatsYearly", String(input.repeatsYearly));
        const row: Countdown = {
          id,
          title: input.title.trim(),
          date: combineDueDateTime(input.date),
          repeatsYearly: input.repeatsYearly,
          createdAt: new Date(),
          notifiedHeadsUpFor: null,
          notifiedOnDayFor: null,
        };
        create((r) => ({ ...r, countdowns: [...r.countdowns, row] }), "addCountdown", [fd], id);
      },
      editCountdown: (id, input) => {
        const fd = new FormData();
        fd.set("title", input.title);
        fd.set("date", input.date);
        fd.set("repeatsYearly", String(input.repeatsYearly));
        mutate(
          (r) => ({
            ...r,
            countdowns: r.countdowns.map((c) =>
              c.id === id
                ? { ...c, title: input.title.trim(), date: combineDueDateTime(input.date), repeatsYearly: input.repeatsYearly }
                : c
            ),
          }),
          "editCountdown",
          [id, fd]
        );
      },
      removeCountdown: (id) => {
        const captured = rawRef.current.countdowns.find((c) => c.id === id);
        if (!captured) return;
        deleteWithUndo(
          "Countdown",
          (r) => ({ ...r, countdowns: r.countdowns.filter((c) => c.id !== id) }),
          (r) => ({ ...r, countdowns: [...r.countdowns, captured] }),
          () => enqueue("removeCountdown", [id])
        );
      },

      // --- Habits ---
      addHabit: (input) => {
        const id = tempId();
        const fd = habitFormData(input);
        create(
          (r) => ({
            ...r,
            habits: [
              ...r.habits,
              {
                id,
                title: input.title.trim(),
                scheduleType: input.scheduleType,
                targetCount: input.targetCount,
                daysOfWeek: input.daysOfWeek,
                durationMinutes: input.durationMinutes ?? null,
                pauseStart: null,
                pauseEnd: null,
              },
            ],
          }),
          "addHabit",
          [fd],
          id
        );
      },
      editHabit: (id, input) => {
        const fd = habitFormData(input);
        mutate(
          (r) => ({
            ...r,
            habits: r.habits.map((h) =>
              h.id === id
                ? {
                    ...h,
                    title: input.title.trim(),
                    scheduleType: input.scheduleType,
                    targetCount: input.targetCount,
                    daysOfWeek: input.daysOfWeek,
                    durationMinutes: input.durationMinutes ?? null,
                  }
                : h
            ),
          }),
          "editHabit",
          [id, fd]
        );
      },
      // Mark done today — adds today's completion row (idempotent). Streak/progress re-derive.
      markHabitDone: (id) =>
        mutate(
          (r) => {
            const dateKey = habitDateKey(new Date(), r.timeZone);
            if (hasCompletion(r, id, dateKey)) return r;
            return { ...r, habitCompletions: [...r.habitCompletions, newCompletion(id, dateKey)] };
          },
          "markHabitDone",
          [id]
        ),
      // Heatmap edit — add the completion if the day is empty, remove it if already there.
      toggleHabitCompletion: (habitId, dateKey) =>
        mutate(
          (r) =>
            hasCompletion(r, habitId, dateKey)
              ? { ...r, habitCompletions: r.habitCompletions.filter((c) => !(c.habitId === habitId && completionKey(c) === dateKey)) }
              : { ...r, habitCompletions: [...r.habitCompletions, newCompletion(habitId, dateKey)] },
          "toggleHabitCompletion",
          [habitId, dateKey]
        ),
      setHabitPause: (id, pauseStart, pauseEnd) => {
        const fd = new FormData();
        fd.set("pauseStart", pauseStart);
        fd.set("pauseEnd", pauseEnd);
        const valid = /^\d{4}-\d{2}-\d{2}$/.test(pauseStart) && /^\d{4}-\d{2}-\d{2}$/.test(pauseEnd);
        mutate(
          (r) => ({
            ...r,
            habits: r.habits.map((h) =>
              h.id === id
                ? { ...h, pauseStart: valid ? combineDueDateTime(pauseStart) : null, pauseEnd: valid ? combineDueDateTime(pauseEnd) : null }
                : h
            ),
          }),
          "setHabitPause",
          [id, fd]
        );
      },
      removeHabit: (id) => {
        const captured = rawRef.current.habits.find((h) => h.id === id);
        if (!captured) return;
        // Deleting the habit cascades its completions server-side; mirror that locally (and
        // restore them on undo) so the heatmap/status stay consistent.
        const capturedCompletions = rawRef.current.habitCompletions.filter((c) => c.habitId === id);
        deleteWithUndo(
          "Habit",
          (r) => ({ ...r, habits: r.habits.filter((h) => h.id !== id), habitCompletions: r.habitCompletions.filter((c) => c.habitId !== id) }),
          (r) => ({ ...r, habits: [...r.habits, captured], habitCompletions: [...r.habitCompletions, ...capturedCompletions] }),
          () => enqueue("removeHabit", [id])
        );
      },

      // --- Routines ---
      addRoutine: (input) => {
        const id = tempId();
        create(
          (r) => ({
            ...r,
            routines: [
              ...r.routines,
              {
                id,
                title: input.title.trim(),
                reminderTime: input.reminderTime.trim(),
                frequency: input.frequency,
                interval: input.interval,
                daysOfWeek: input.frequency === "WEEKLY" ? input.daysOfWeek : [],
                monthlyMode: input.monthlyMode,
                dayOfMonth: input.dayOfMonth,
                monthlyOrdinal: input.monthlyOrdinal,
                monthlyWeekday: input.monthlyWeekday,
                durationMinutes: input.durationMinutes,
                isActive: true,
                lastCompletedAt: null,
                notifiedAt: null,
                pausedUntil: null,
                parentId: null,
                subroutines: [],
              },
            ],
          }),
          "addRoutine",
          [routineToFd(input)],
          id
        );
      },
      editRoutine: (id, input) =>
        mutate(
          (r) => ({
            ...r,
            routines: r.routines.map((rt) =>
              rt.id === id
                ? {
                    ...rt,
                    title: input.title.trim(),
                    reminderTime: input.reminderTime.trim(),
                    frequency: input.frequency,
                    interval: input.interval,
                    daysOfWeek: input.frequency === "WEEKLY" ? input.daysOfWeek : [],
                    monthlyMode: input.monthlyMode,
                    dayOfMonth: input.dayOfMonth,
                    monthlyOrdinal: input.monthlyOrdinal,
                    monthlyWeekday: input.monthlyWeekday,
                    durationMinutes: input.durationMinutes,
                  }
                : rt
            ),
          }),
          "editRoutine",
          [id, routineToFd(input)]
        ),
      addSubroutine: (parentId, title) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("title", title);
        create(
          (r) => ({
            ...r,
            routines: r.routines.map((rt) => {
              if (rt.id !== parentId) return rt;
              // A sub-routine carries the parent's schedule (see api.ts createSubroutine).
              const child: Routine = {
                id,
                title: title.trim(),
                reminderTime: rt.reminderTime,
                frequency: rt.frequency,
                interval: rt.interval,
                daysOfWeek: rt.daysOfWeek,
                monthlyMode: rt.monthlyMode,
                dayOfMonth: rt.dayOfMonth,
                monthlyOrdinal: rt.monthlyOrdinal,
                monthlyWeekday: rt.monthlyWeekday,
                durationMinutes: null,
                isActive: rt.isActive,
                lastCompletedAt: null,
                notifiedAt: null,
                pausedUntil: null,
                parentId,
              };
              return { ...rt, subroutines: [...rt.subroutines, child] };
            }),
          }),
          "addSubroutine",
          [parentId, fd],
          id
        );
      },
      tickRoutine: (id) => {
        const now = new Date();
        mutate(
          (r) => ({
            ...r,
            routines: r.routines.map((rt) =>
              rt.id === id
                ? { ...rt, lastCompletedAt: now, notifiedAt: now, subroutines: rt.subroutines.map((s) => ({ ...s, lastCompletedAt: now, notifiedAt: now })) }
                : rt
            ),
          }),
          "tickRoutine",
          [id]
        );
      },
      untickRoutine: (id) =>
        mutate(
          (r) => ({
            ...r,
            routines: r.routines.map((rt) =>
              rt.id === id
                ? { ...rt, lastCompletedAt: null, subroutines: rt.subroutines.map((s) => ({ ...s, lastCompletedAt: null })) }
                : rt
            ),
          }),
          "untickRoutine",
          [id]
        ),
      setRoutinePause: (id, pausedUntil) => {
        const fd = new FormData();
        fd.set("pausedUntil", pausedUntil);
        mutate(
          (r) => ({
            ...r,
            routines: r.routines.map((rt) => (rt.id === id ? { ...rt, pausedUntil: pausedUntil ? new Date(pausedUntil) : null } : rt)),
          }),
          "setRoutinePause",
          [id, fd]
        );
      },
      removeRoutine: (id) => {
        const top = rawRef.current.routines.find((rt) => rt.id === id);
        const parent = rawRef.current.routines.find((rt) => rt.subroutines.some((s) => s.id === id));
        const child = parent?.subroutines.find((s) => s.id === id);
        if (!top && !child) return;
        deleteWithUndo(
          top ? "Routine" : "Step",
          (r) => ({
            ...r,
            routines: r.routines
              .filter((rt) => rt.id !== id)
              .map((rt) => (rt.subroutines.some((s) => s.id === id) ? { ...rt, subroutines: rt.subroutines.filter((s) => s.id !== id) } : rt)),
          }),
          (r) =>
            top
              ? { ...r, routines: [...r.routines, top] }
              : {
                  ...r,
                  routines: r.routines.map((rt) => (rt.id === parent!.id ? { ...rt, subroutines: [...rt.subroutines, child!] } : rt)),
                },
          () => enqueue("removeRoutine", [id])
        );
      },

      // --- Categories ---
      addCategory: (name) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("name", name);
        create(
          (r) => ({ ...r, categories: [...r.categories, { id, name: name.trim(), scope: "NONE" as const }].sort((a, b) => a.name.localeCompare(b.name)) }),
          "addCategory",
          [fd],
          id
        );
      },
      renameCategory: (id, name) => {
        const fd = new FormData();
        fd.set("name", name);
        // Category names are mirrored onto Task.category — rename both locally.
        mutate((r) => {
          const before = r.categories.find((c) => c.id === id)?.name;
          const next = name.trim();
          return {
            ...r,
            categories: r.categories.map((c) => (c.id === id ? { ...c, name: next } : c)).sort((a, b) => a.name.localeCompare(b.name)),
            tasks: before
              ? r.tasks.map((t) => ({
                  ...t,
                  category: t.category === before ? next : t.category,
                  subtasks: t.subtasks.map((s) => ({ ...s, category: s.category === before ? next : s.category })),
                }))
              : r.tasks,
          };
        }, "renameCategory", [id, fd]);
      },
      setCategoryScope: (id, scope) => {
        const fd = new FormData();
        fd.set("scope", scope);
        mutate(
          (r) => ({ ...r, categories: r.categories.map((c) => (c.id === id ? { ...c, scope } : c)) }),
          "setCategoryScope",
          [id, fd]
        );
      },
      removeCategory: (id) => mutate((r) => ({ ...r, categories: r.categories.filter((c) => c.id !== id) }), "removeCategory", [id]),

      // --- My Day plan blocks ---
      addDayPlanBlock: (input) => {
        const id = tempId();
        const row: DayPlanBlock = {
          id,
          date: combineDueDateTime(input.date),
          entityType: input.entityType,
          entityId: input.entityId,
          startTime: input.startTime ?? null,
          durationMinutes: input.durationMinutes ?? null,
          sortOrder: null,
          createdAt: new Date(),
        };
        const fd = new FormData();
        fd.set("date", input.date);
        fd.set("entityType", input.entityType);
        fd.set("entityId", input.entityId);
        if (row.startTime) fd.set("startTime", row.startTime);
        if (row.durationMinutes) fd.set("duration", String(row.durationMinutes));
        create(
          // The server upserts on (date, entityType, entityId) — mirror that locally so a
          // repeated "do today"/re-place updates the existing row instead of duplicating it.
          (r) => {
            const existing = r.dayPlanBlocks.find(
              (b) =>
                b.entityType === row.entityType &&
                b.entityId === row.entityId &&
                new Date(b.date).getTime() === row.date.getTime()
            );
            if (existing) {
              return {
                ...r,
                dayPlanBlocks: r.dayPlanBlocks.map((b) =>
                  b.id === existing.id
                    ? { ...b, startTime: row.startTime, durationMinutes: row.durationMinutes ?? b.durationMinutes }
                    : b
                ),
              };
            }
            return { ...r, dayPlanBlocks: [...r.dayPlanBlocks, row] };
          },
          "addDayPlanBlock",
          [fd],
          id
        );
      },
      updateDayPlanBlock: (id, input) => {
        // The server action is whole-record, so merge the patch over the current row and send
        // every field — an omitted startTime/duration would otherwise be cleared server-side.
        const current = rawRef.current.dayPlanBlocks.find((b) => b.id === id);
        if (!current) return;
        const next: DayPlanBlock = {
          ...current,
          date: input.date !== undefined ? combineDueDateTime(input.date) : new Date(current.date),
          startTime: input.startTime !== undefined ? input.startTime : current.startTime,
          durationMinutes: input.durationMinutes !== undefined ? input.durationMinutes : current.durationMinutes,
        };
        const fd = new FormData();
        fd.set("date", new Date(next.date).toISOString().slice(0, 10));
        if (next.startTime) fd.set("startTime", next.startTime);
        if (next.durationMinutes) fd.set("duration", String(next.durationMinutes));
        if (next.sortOrder != null) fd.set("sortOrder", String(next.sortOrder));
        mutate(
          (r) => ({ ...r, dayPlanBlocks: r.dayPlanBlocks.map((b) => (b.id === id ? next : b)) }),
          "updateDayPlanBlock",
          [id, fd]
        );
      },
      removeDayPlanBlock: (id) =>
        mutate((r) => ({ ...r, dayPlanBlocks: r.dayPlanBlocks.filter((b) => b.id !== id) }), "removeDayPlanBlock", [id]),

      // --- AI planner suggestions + notes ---
      acceptSuggestion: (id, category, dueDate) => {
        const suggestion = rawRef.current.suggestions.find((s) => s.id === id);
        if (!suggestion) return;
        const taskId = tempId();
        const row: RawTask = {
          id: taskId,
          title: suggestion.title,
          description: suggestion.description,
          category,
          dueDate: dueDate ? combineDueDateTime(dueDate) : suggestion.suggestedDate ? new Date(suggestion.suggestedDate) : null,
          isCompleted: false,
          completedAt: null,
          createdAt: new Date(),
          notifiedAt: null,
          projectId: null,
          parentId: null,
          section: null,
          sortOrder: null,
          reminderLeadMinutes: null,
          durationMinutes: null,
          blockedReason: null,
          blockedUntil: null,
          noteId: null,
          noteBlockId: null,
          pausedUntil: null,
          subtasks: [],
          ...NO_REPEAT,
        };
        const fd = new FormData();
        fd.set("category", category);
        if (dueDate) fd.set("dueDate", dueDate);
        create(
          (r) => ({
            ...r,
            suggestions: r.suggestions.filter((s) => s.id !== id),
            tasks: [...r.tasks, row],
          }),
          "acceptSuggestion",
          [id, fd],
          taskId
        );
      },
      snoozeSuggestion: (id, untilDate) => {
        const fd = new FormData();
        fd.set("snoozedUntil", untilDate);
        mutate((r) => ({ ...r, suggestions: r.suggestions.filter((s) => s.id !== id) }), "snoozeSuggestion", [id, fd]);
      },
      dismissSuggestion: (id) =>
        mutate((r) => ({ ...r, suggestions: r.suggestions.filter((s) => s.id !== id) }), "dismissSuggestion", [id]),
      addAiNote: (content) => {
        const id = tempId();
        const row: AiNote = { id, content: content.trim(), createdAt: new Date() };
        const fd = new FormData();
        fd.set("content", row.content);
        create((r) => ({ ...r, aiNotes: [...r.aiNotes, row] }), "addAiNote", [fd], id);
      },
      removeAiNote: (id) =>
        mutate((r) => ({ ...r, aiNotes: r.aiNotes.filter((n) => n.id !== id) }), "removeAiNote", [id]),

      // --- Voice captures ---
      dismissCapture: (id) => mutate((r) => ({ ...r, captures: r.captures.filter((c) => c.id !== id) }), "dismissCapture", [id]),

      // --- Settings / calendar ---
      setTimeZone: (timeZone) => mutate((r) => ({ ...r, timeZone }), "setTimeZone", [timeZone]),
      dismissEvent: (eventId) =>
        mutate((r) => ({ ...r, dismissedEventIds: [...r.dismissedEventIds, eventId] }), "dismissEvent", [eventId]),
      restoreEvent: (eventId) =>
        mutate(
          (r) => ({ ...r, dismissedEventIds: r.dismissedEventIds.filter((id) => id !== eventId) }),
          "restoreEvent",
          [eventId]
        ),
    };
  }, [enqueue, deleteWithUndo, pushToast, refreshNow, editNoteBody]);

  const data = useMemo<TaskbookData>(
    () => ({
      ...serverData,
      todayLabel,
      // Whichever heartbeat is newer: the last full render's, or the one a version check brought
      // back without rendering.
      lastCronAtMs:
        cronAtMs !== null && serverData.lastCronAtMs !== null
          ? Math.max(cronAtMs, serverData.lastCronAtMs)
          : (cronAtMs ?? serverData.lastCronAtMs),
      calendarErrors,
      ...deriveEntities(raw, liveNowMs, mode),
    }),
    [serverData, todayLabel, cronAtMs, calendarErrors, raw, liveNowMs, mode]
  );

  return (
    <TaskbookContext.Provider
      value={{ data, actions, raw, calendarEvents: events, refreshCalendar, calendarRefreshing, syncNow, syncing, nowMs: liveNowMs, mode, setMode, offline, pendingOps, toasts, dismissToast, subscribeNoteEdits }}
    >
      {ready ? children : <AppFrame />}
    </TaskbookContext.Provider>
  );
}
