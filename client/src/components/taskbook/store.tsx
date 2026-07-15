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
import { useRouter } from "next/navigation";
import type { HabitCompletion, HabitScheduleType, Routine, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";
import * as serverActions from "@/app/actions";
import { deriveEntities, type RawState, type RawTask } from "@/lib/derive";
import {
  combineDueDateTime,
  habitDateKey,
  MS_PER_DAY,
  NO_REPEAT,
} from "@/lib/shared";
import {
  deserializeArg,
  idbAvailable,
  isNetworkError,
  kvGet,
  kvSet,
  outboxAdd,
  outboxCount,
  outboxDelete,
  outboxPeek,
  remapArgIds,
  serializeArg,
  type SerializedArg,
} from "@/lib/offline";
import { nextOccurrence, resolveTaskRepeat, type TaskRepeatRule } from "@/lib/taskRecurrence";
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

function isMode(v: string | null): v is Mode {
  return v === "work" || v === "home" || v === "all";
}

// Server snapshot fields that this store does NOT derive (labels/errors/heartbeat — the
// calendar view itself is computed by deriveCalendarView, called from TaskbookApp since it
// also needs the viewed month, which this store doesn't own).
export type ServerCalendarData = Omit<
  TaskbookData,
  | "taskGroups"
  | "tasksRemainingToday"
  | "projectCards"
  | "activeProjectCount"
  | "routineList"
  | "routineTotalCount"
  | "habits"
  | "habitAtRiskCount"
  | "projectOptions"
  | "categoryOptions"
  | "pendingCaptures"
>;

export type TaskRepeatInput = {
  frequency: RoutineFrequency;
  interval?: number;
  daysOfWeek?: number[];
  monthlyMode?: RoutineMonthlyMode;
  dayOfMonth?: number | null;
  monthlyOrdinal?: number | null;
  monthlyWeekday?: number | null;
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
  setTaskSection: (id: string, section: string) => void;
  setTaskReminderLead: (id: string, minutes: number | null) => void;
  setTaskDuration: (id: string, minutes: number | null) => void;
  snoozeTask: (id: string, days: number) => void;
  reorderGroup: (orderedIds: string[]) => void;
  // Projects
  addProject: (input: ProjectInput) => void;
  editProject: (id: string, input: ProjectInput) => void;
  duplicateProject: (templateId: string, name: string) => void;
  renameProject: (id: string, name: string) => void;
  setProjectDescription: (id: string, description: string) => void;
  setProjectDueDate: (id: string, dueDate: string) => void;
  toggleProject: (id: string, isCompleted: boolean) => void;
  removeProject: (id: string) => void;
  // Habits
  addHabit: (input: HabitInput) => void;
  editHabit: (id: string, input: HabitInput) => void;
  markHabitDone: (id: string) => void;
  toggleHabitCompletion: (habitId: string, dateKey: string) => void;
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
  nowMs: number;
  mode: Mode;
  setMode: (mode: Mode) => void;
  offline: boolean;
  pendingOps: number;
  toasts: Toast[];
  dismissToast: (id: number) => void;
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

function repeatFields(repeat: TaskRepeatInput) {
  return repeat ? resolveTaskRepeat(repeat) : NO_REPEAT;
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
  setTaskSection: { fn: serverActions.updateTaskSection },
  setTaskReminderLead: { fn: serverActions.updateTaskReminderLead },
  setTaskDuration: { fn: serverActions.updateTaskDuration },
  snoozeTask: { fn: serverActions.snoozeTask },
  reorderGroup: { fn: serverActions.reorderTaskGroup },
  addProject: {
    fn: serverActions.addProject,
    swap: (r, temp, real) => ({ ...r, projects: r.projects.map((p) => (p.id === temp ? { ...p, id: real } : p)) }),
  },
  editProject: { fn: serverActions.editProject },
  renameProject: { fn: serverActions.renameProject },
  setProjectDescription: { fn: serverActions.updateProjectDescription },
  setProjectDueDate: { fn: serverActions.updateProjectDueDate },
  toggleProject: { fn: serverActions.toggleProject },
  removeProject: { fn: serverActions.removeProject },
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
  dismissCapture: { fn: serverActions.dismissCapture },
  setTimeZone: { fn: serverActions.updateTimeZone },
  dismissEvent: { fn: serverActions.dismissCalendarEvent },
  restoreEvent: { fn: serverActions.restoreCalendarEvent },
};

type Snapshot = { raw: RawState; calendarEvents: CalendarEvent[]; savedAt: number };

export function StoreProvider({
  initialRaw,
  serverData,
  calendarEvents,
  nowMs,
  children,
}: {
  initialRaw: RawState;
  serverData: ServerCalendarData;
  calendarEvents: CalendarEvent[];
  nowMs: number;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [raw, setRaw] = useState(initialRaw);
  const [events, setEvents] = useState(calendarEvents);
  // Undo-capture reads the current row without making `actions` depend on (and rebuild with)
  // every raw change. Updated in an effect (not during render) per react-hooks/refs; handlers
  // only run after effects, so they always see the latest value.
  const rawRef = useRef(raw);
  useEffect(() => {
    rawRef.current = raw;
  }, [raw]);
  const [offline, setOffline] = useState(false);
  const [pendingOps, setPendingOps] = useState(0);
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
  if (initialRaw !== seededFrom) {
    setSeededFrom(initialRaw);
    setRaw(initialRaw);
    setEvents(calendarEvents);
  }

  // --- Toasts -------------------------------------------------------------------------------

  const toastSeq = useRef(0);
  const pushToast = useCallback((message: string, actionLabel?: string, onAction?: () => void) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((ts) => [...ts, { id, message, actionLabel, onAction }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), UNDO_MS);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  // --- Outbox -------------------------------------------------------------------------------

  const flushingRef = useRef(false);
  const backoffDelayRef = useRef(30_000);
  const backoffTimerRef = useRef<number | null>(null);
  const hadFailureRef = useRef(false);
  const idMapRef = useRef<Record<string, string>>({});
  const refreshAtRef = useRef(0);

  const refreshNow = useCallback(() => {
    refreshAtRef.current = Date.now();
    router.refresh();
  }, [router]);

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
        if (!op) break;
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
      refreshNow();
    }
  }, [pushToast, refreshNow, syncPendingCount]);

  // The backoff timer captures flush across renders via a ref to avoid stale closures.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

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
            refreshNow();
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
            refreshNow();
          });
        });
    },
    [refreshNow, syncPendingCount]
  );

  // --- Persistence & lifecycle ---------------------------------------------------------------

  // Register the service worker on every load (used to happen only when Settings was opened,
  // which meant a device that never visited Settings had no offline shell and no push).
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => console.error("[sw] register failed:", err));
    }
  }, []);

  // Hydrate from the IndexedDB snapshot when it's newer than the server render (the service
  // worker served a cached shell) or when queued ops exist (their optimistic rows only live
  // in the snapshot). One-shot, on mount.
  useEffect(() => {
    if (!idbAvailable()) return;
    let cancelled = false;
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
        if (snapshot && (snapshot.savedAt > nowMs || queued > 0 || offlineNow)) {
          setRaw(snapshot.raw);
          if (snapshot.calendarEvents?.length) setEvents(snapshot.calendarEvents);
        }
        if (offlineNow) setOffline(true);
        if (queued > 0) void flushRef.current();
      } catch (err) {
        console.error("[store] snapshot hydration failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Snapshot the raw state (debounced) so an offline start has data to render.
  useEffect(() => {
    if (!idbAvailable()) return;
    const timer = window.setTimeout(() => {
      void kvSet(SNAPSHOT_KEY, { raw, calendarEvents: events, savedAt: Date.now() } satisfies Snapshot).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [raw, events]);

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
          if (queued === 0) refreshNow();
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
  }, [refreshNow]);

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

  // `router` from useRouter() is a stable instance, so these callbacks are built once and reused.
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
      toggleTask: (id, isCompleted) =>
        mutate(
          (r) => ({
            ...r,
            tasks: mapTask(r.tasks, id, (t) => {
              if (isCompleted) return { ...t, isCompleted: false, completedAt: null };
              const rule = repeatRuleOf(t);
              if (rule && t.dueDate) {
                return { ...t, dueDate: nextOccurrence(new Date(t.dueDate), rule), isCompleted: false, notifiedAt: null };
              }
              return { ...t, isCompleted: true, completedAt: new Date() };
            }),
          }),
          "toggleTask",
          [id, isCompleted]
        ),
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
          () => enqueue("removeTask", [id])
        );
      },
      renameTask: (id, title) => {
        const fd = new FormData();
        fd.set("title", title);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, title })) }), "renameTask", [id, fd]);
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
      snoozeTask: (id, days) =>
        mutate(
          (r) => ({
            ...r,
            tasks: mapTask(r.tasks, id, (t) => ({
              ...t,
              dueDate: new Date((t.dueDate ? new Date(t.dueDate).getTime() : Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) + days * MS_PER_DAY),
              notifiedAt: null,
            })),
          }),
          "snoozeTask",
          [id, days]
        ),
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
              },
            ],
          }),
          "addProject",
          [fd],
          id
        );
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
          .then(() => refreshNow())
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
      removeProject: (id) => {
        const captured = rawRef.current.projects.find((p) => p.id === id);
        if (!captured) return;
        deleteWithUndo(
          "Project",
          (r) => ({ ...r, projects: r.projects.filter((p) => p.id !== id) }),
          (r) => ({ ...r, projects: [...r.projects, captured] }),
          () => enqueue("removeProject", [id])
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
  }, [enqueue, deleteWithUndo, pushToast, refreshNow]);

  const data = useMemo<TaskbookData>(
    () => ({ ...serverData, ...deriveEntities(raw, liveNowMs, mode) }),
    [serverData, raw, liveNowMs, mode]
  );

  return (
    <TaskbookContext.Provider
      value={{ data, actions, raw, calendarEvents: events, nowMs: liveNowMs, mode, setMode, offline, pendingOps, toasts, dismissToast }}
    >
      {children}
    </TaskbookContext.Provider>
  );
}
