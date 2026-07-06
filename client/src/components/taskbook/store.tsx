"use client";

// The optimistic client store. Holds the raw entity rows seeded from the server, applies every
// interaction to that local state *immediately* (so the UI reacts in ~0ms), and fires the
// matching server action in the background. The server is reconciled lazily: on any action
// error, and whenever the tab regains focus, we router.refresh() to re-pull server truth —
// which flows back down as new `initialRaw`/`serverData` props and re-seeds the store.
//
// View-models are re-derived from raw state via deriveEntities() on every change, so grouping,
// due-bucketing, counts and streaks all update exactly as a server round trip would have.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { HabitIntervalUnit, Routine, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";
import {
  addCategory as addCategoryAction,
  addHabit as addHabitAction,
  addProject as addProjectAction,
  addRoutine as addRoutineAction,
  addSubroutine as addSubroutineAction,
  addTask as addTaskAction,
  dismissCalendarEvent as dismissCalendarEventAction,
  dismissCapture as dismissCaptureAction,
  editHabit as editHabitAction,
  editProject as editProjectAction,
  editRoutine as editRoutineAction,
  markHabitDone as markHabitDoneAction,
  removeCategory as removeCategoryAction,
  removeHabit as removeHabitAction,
  removeProject as removeProjectAction,
  removeRoutine as removeRoutineAction,
  removeTask as removeTaskAction,
  renameCategory as renameCategoryAction,
  renameProject as renameProjectAction,
  renameTask as renameTaskAction,
  restoreCalendarEvent as restoreCalendarEventAction,
  tickRoutine as tickRoutineAction,
  toggleProject as toggleProjectAction,
  toggleTask as toggleTaskAction,
  updateProjectDescription as updateProjectDescriptionAction,
  updateProjectDueDate as updateProjectDueDateAction,
  updateRoutinePause as updateRoutinePauseAction,
  updateTaskCategory as updateTaskCategoryAction,
  updateTaskDescription as updateTaskDescriptionAction,
  updateTaskDueDate as updateTaskDueDateAction,
  updateTaskProject as updateTaskProjectAction,
  updateTaskRepeat as updateTaskRepeatAction,
  updateTimeZone as updateTimeZoneAction,
} from "@/app/actions";
import { combineDueDateTime, deriveEntities, type RawState, type RawTask } from "@/lib/derive";
import { nextOccurrence, resolveTaskRepeat, type TaskRepeatRule } from "@/lib/taskRecurrence";
import type { CalendarEvent, Mode, TaskbookData } from "./types";

// Persists the work/personal/all toggle across sessions — this is a pure client display
// preference, not server state, so it lives in localStorage rather than the DB.
const MODE_STORAGE_KEY = "taskbook-mode";

function isMode(v: string | null): v is Mode {
  return v === "work" || v === "personal" || v === "all";
}

// Server snapshot fields that this store does NOT derive (just labels/errors — the calendar
// view itself is computed by deriveCalendarView, called from TaskbookApp since it also needs
// the viewed month, which this store doesn't own). Merged over the derived entity fields to
// reconstruct the full TaskbookData.
export type ServerCalendarData = Omit<
  TaskbookData,
  | "taskGroups"
  | "tasksRemainingToday"
  | "projectCards"
  | "activeProjectCount"
  | "routineList"
  | "routineTotalCount"
  | "habitSuggested"
  | "habitOnTrack"
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
};

export type ProjectInput = { name: string; description?: string | null; dueDate?: string | null };
export type HabitInput = { title: string; intervalValue: number; intervalUnit: HabitIntervalUnit };
export type RoutineInput = {
  title: string;
  reminderTime: string;
  frequency: RoutineFrequency;
  interval: number;
  daysOfWeek: number[];
  monthlyMode: RoutineMonthlyMode;
  dayOfMonth: number | null;
  monthlyOrdinal: number | null;
  monthlyWeekday: number | null;
};

export type TaskbookActions = {
  // Tasks
  addTask: (input: TaskCreateInput) => void;
  toggleTask: (id: string, isCompleted: boolean) => void;
  removeTask: (id: string) => void;
  renameTask: (id: string, title: string) => void;
  setTaskDescription: (id: string, description: string) => void;
  setTaskCategory: (id: string, category: string) => void;
  setTaskProject: (id: string, projectId: string) => void;
  setTaskDue: (id: string, dueDate: string, dueTime: string) => void;
  setTaskRepeat: (id: string, repeat: TaskRepeatInput) => void;
  // Projects
  addProject: (input: ProjectInput) => void;
  editProject: (id: string, input: ProjectInput) => void;
  renameProject: (id: string, name: string) => void;
  setProjectDescription: (id: string, description: string) => void;
  setProjectDueDate: (id: string, dueDate: string) => void;
  toggleProject: (id: string, isCompleted: boolean) => void;
  removeProject: (id: string) => void;
  // Habits
  addHabit: (input: HabitInput) => void;
  editHabit: (id: string, input: HabitInput) => void;
  markHabitDone: (id: string) => void;
  removeHabit: (id: string) => void;
  // Routines
  addRoutine: (input: RoutineInput) => void;
  editRoutine: (id: string, input: RoutineInput) => void;
  addSubroutine: (parentId: string, title: string) => void;
  tickRoutine: (id: string) => void;
  setRoutinePause: (id: string, pausedUntil: string) => void;
  removeRoutine: (id: string) => void;
  // Categories
  addCategory: (name: string) => void;
  renameCategory: (id: string, name: string) => void;
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

const NO_REPEAT = {
  repeatFrequency: null,
  repeatInterval: null,
  repeatDaysOfWeek: [] as number[],
  repeatMonthlyMode: null,
  repeatDayOfMonth: null,
  repeatMonthlyOrdinal: null,
  repeatMonthlyWeekday: null,
};

function repeatFields(repeat: TaskRepeatInput) {
  return repeat ? resolveTaskRepeat(repeat) : NO_REPEAT;
}

// The UI only ever mutates top-level tasks (subtasks surface as a progress count, not as
// their own toggle/delete controls), so these operate on the top-level list.
function mapTask(tasks: RawTask[], id: string, fn: (t: RawTask) => RawTask): RawTask[] {
  return tasks.map((t) => (t.id === id ? fn(t) : t));
}

function removeTaskById(tasks: RawTask[], id: string): RawTask[] {
  return tasks.filter((t) => t.id !== id);
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
  fd.set("frequency", input.frequency);
  fd.set("interval", String(input.interval));
  fd.set("monthlyMode", input.monthlyMode);
  if (input.dayOfMonth != null) fd.set("dayOfMonth", String(input.dayOfMonth));
  if (input.monthlyOrdinal != null) fd.set("monthlyOrdinal", String(input.monthlyOrdinal));
  if (input.monthlyWeekday != null) fd.set("monthlyWeekday", String(input.monthlyWeekday));
  for (const d of input.daysOfWeek) fd.append("daysOfWeek", String(d));
  return fd;
}

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
  }

  // Reconcile with the server when the tab regains focus (covers optimistic drift, other
  // devices, and voice captures landing while away).
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    window.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  // `router` from useRouter() is a stable instance, so these callbacks are built once and reused.
  const actions = useMemo<TaskbookActions>(() => {
    // Fire a background write; on failure, fall back to server truth.
    const send = (run: () => Promise<unknown>) => {
      run().catch((err) => {
        console.error("[store] background sync failed, refreshing:", err);
        router.refresh();
      });
    };

    // Optimistic mutate + background write for the common (non-create) case.
    const mutate = (patch: (r: RawState) => RawState, run: () => Promise<unknown>) => {
      setRaw(patch);
      send(run);
    };

    // Create: insert a temp row, then swap in the real id the server assigns.
    const create = (patch: (r: RawState) => RawState, run: () => Promise<string | undefined>, swap: (r: RawState, realId: string) => RawState) => {
      setRaw(patch);
      run()
        .then((realId) => {
          if (realId) setRaw((r) => swap(r, realId));
        })
        .catch((err) => {
          console.error("[store] create failed, refreshing:", err);
          router.refresh();
        });
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
          createdAt: now,
          notifiedAt: null,
          projectId: input.projectId || null,
          parentId: input.parentId || null,
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
        repeatToFd(fd, input.repeat ?? null);
        create(
          (r) =>
            row.parentId
              ? { ...r, tasks: mapTask(r.tasks, row.parentId, (p) => ({ ...p, subtasks: [...p.subtasks, row] })) }
              : { ...r, tasks: [...r.tasks, row] },
          () => addTaskAction(fd),
          (r, realId) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, id: realId })) })
        );
      },
      toggleTask: (id, isCompleted) =>
        mutate(
          (r) => ({
            ...r,
            tasks: mapTask(r.tasks, id, (t) => {
              if (isCompleted) return { ...t, isCompleted: false };
              const rule = repeatRuleOf(t);
              if (rule && t.dueDate) {
                return { ...t, dueDate: nextOccurrence(new Date(t.dueDate), rule), isCompleted: false, notifiedAt: null };
              }
              return { ...t, isCompleted: true };
            }),
          }),
          () => toggleTaskAction(id, isCompleted)
        ),
      removeTask: (id) => mutate((r) => ({ ...r, tasks: removeTaskById(r.tasks, id) }), () => removeTaskAction(id)),
      renameTask: (id, title) => {
        const fd = new FormData();
        fd.set("title", title);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, title })) }), () => renameTaskAction(id, fd));
      },
      setTaskDescription: (id, description) => {
        const fd = new FormData();
        fd.set("description", description);
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, description: description || null })) }),
          () => updateTaskDescriptionAction(id, fd)
        );
      },
      setTaskCategory: (id, category) => {
        const fd = new FormData();
        fd.set("category", category);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, category })) }), () => updateTaskCategoryAction(id, fd));
      },
      setTaskProject: (id, projectId) => {
        const fd = new FormData();
        fd.set("projectId", projectId);
        mutate(
          (r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, projectId: projectId || null })) }),
          () => updateTaskProjectAction(id, fd)
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
          () => updateTaskDueDateAction(id, fd)
        );
      },
      setTaskRepeat: (id, repeat) => {
        const fd = new FormData();
        repeatToFd(fd, repeat);
        mutate((r) => ({ ...r, tasks: mapTask(r.tasks, id, (t) => ({ ...t, ...repeatFields(repeat) })) }), () => updateTaskRepeatAction(id, fd));
      },

      // --- Projects ---
      addProject: (input) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("name", input.name);
        if (input.description) fd.set("description", input.description);
        if (input.dueDate) fd.set("dueDate", input.dueDate);
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
              },
            ],
          }),
          () => addProjectAction(fd),
          (r, realId) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, id: realId } : p)) })
        );
      },
      editProject: (id, input) => {
        const fd = new FormData();
        fd.set("name", input.name);
        if (input.description) fd.set("description", input.description);
        if (input.dueDate) fd.set("dueDate", input.dueDate);
        mutate(
          (r) => ({
            ...r,
            projects: r.projects.map((p) =>
              p.id === id
                ? { ...p, name: input.name.trim(), description: input.description?.trim() || null, dueDate: input.dueDate ? new Date(input.dueDate) : null }
                : p
            ),
          }),
          () => editProjectAction(id, fd)
        );
      },
      renameProject: (id, name) => {
        const fd = new FormData();
        fd.set("name", name);
        mutate((r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, name } : p)) }), () => renameProjectAction(id, fd));
      },
      setProjectDescription: (id, description) => {
        const fd = new FormData();
        fd.set("description", description);
        mutate(
          (r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, description: description || null } : p)) }),
          () => updateProjectDescriptionAction(id, fd)
        );
      },
      setProjectDueDate: (id, dueDate) => {
        const fd = new FormData();
        fd.set("dueDate", dueDate);
        mutate(
          (r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, dueDate: dueDate ? new Date(dueDate) : null, notifiedAt: null } : p)) }),
          () => updateProjectDueDateAction(id, fd)
        );
      },
      toggleProject: (id, isCompleted) =>
        mutate(
          (r) => ({ ...r, projects: r.projects.map((p) => (p.id === id ? { ...p, isCompleted: !isCompleted } : p)) }),
          () => toggleProjectAction(id, isCompleted)
        ),
      removeProject: (id) => mutate((r) => ({ ...r, projects: r.projects.filter((p) => p.id !== id) }), () => removeProjectAction(id)),

      // --- Habits ---
      addHabit: (input) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("title", input.title);
        fd.set("intervalValue", String(input.intervalValue));
        fd.set("intervalUnit", input.intervalUnit);
        create(
          (r) => ({
            ...r,
            habits: [
              ...r.habits,
              {
                id,
                title: input.title.trim(),
                intervalValue: input.intervalValue,
                intervalUnit: input.intervalUnit,
                currentStreak: 0,
                longestStreak: 0,
                lastCompletedDate: null,
              },
            ],
          }),
          () => addHabitAction(fd),
          (r, realId) => ({ ...r, habits: r.habits.map((h) => (h.id === id ? { ...h, id: realId } : h)) })
        );
      },
      editHabit: (id, input) => {
        const fd = new FormData();
        fd.set("title", input.title);
        fd.set("intervalValue", String(input.intervalValue));
        fd.set("intervalUnit", input.intervalUnit);
        mutate(
          (r) => ({
            ...r,
            habits: r.habits.map((h) =>
              h.id === id ? { ...h, title: input.title.trim(), intervalValue: input.intervalValue, intervalUnit: input.intervalUnit } : h
            ),
          }),
          () => editHabitAction(id, fd)
        );
      },
      markHabitDone: (id) =>
        mutate(
          (r) => ({
            ...r,
            habits: r.habits.map((h) => {
              if (h.id !== id) return h;
              const windowMs = h.intervalValue * (h.intervalUnit === "WEEK" ? 7 : h.intervalUnit === "MONTH" ? 30 : 1) * 86_400_000;
              const now = new Date();
              const nowPeriod = Math.floor(now.getTime() / windowMs);
              let currentStreak: number;
              if (!h.lastCompletedDate) {
                currentStreak = 1;
              } else {
                const lastPeriod = Math.floor(new Date(h.lastCompletedDate).getTime() / windowMs);
                if (nowPeriod === lastPeriod) return h; // already done this period
                currentStreak = nowPeriod === lastPeriod + 1 ? h.currentStreak + 1 : 1;
              }
              return { ...h, currentStreak, longestStreak: Math.max(h.longestStreak, currentStreak), lastCompletedDate: now };
            }),
          }),
          () => markHabitDoneAction(id)
        ),
      removeHabit: (id) => mutate((r) => ({ ...r, habits: r.habits.filter((h) => h.id !== id) }), () => removeHabitAction(id)),

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
                isActive: true,
                lastCompletedAt: null,
                notifiedAt: null,
                pausedUntil: null,
                parentId: null,
                subroutines: [],
              },
            ],
          }),
          () => addRoutineAction(routineToFd(input)),
          (r, realId) => ({ ...r, routines: r.routines.map((rt) => (rt.id === id ? { ...rt, id: realId } : rt)) })
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
                  }
                : rt
            ),
          }),
          () => editRoutineAction(id, routineToFd(input))
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
                isActive: rt.isActive,
                lastCompletedAt: null,
                notifiedAt: null,
                pausedUntil: null,
                parentId,
              };
              return { ...rt, subroutines: [...rt.subroutines, child] };
            }),
          }),
          () => addSubroutineAction(parentId, fd),
          (r, realId) => ({
            ...r,
            routines: r.routines.map((rt) =>
              rt.id === parentId ? { ...rt, subroutines: rt.subroutines.map((s) => (s.id === id ? { ...s, id: realId } : s)) } : rt
            ),
          })
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
          () => tickRoutineAction(id)
        );
      },
      setRoutinePause: (id, pausedUntil) => {
        const fd = new FormData();
        fd.set("pausedUntil", pausedUntil);
        mutate(
          (r) => ({
            ...r,
            routines: r.routines.map((rt) => (rt.id === id ? { ...rt, pausedUntil: pausedUntil ? new Date(pausedUntil) : null } : rt)),
          }),
          () => updateRoutinePauseAction(id, fd)
        );
      },
      removeRoutine: (id) =>
        mutate(
          (r) => ({
            ...r,
            routines: r.routines
              .filter((rt) => rt.id !== id)
              .map((rt) => (rt.subroutines.some((s) => s.id === id) ? { ...rt, subroutines: rt.subroutines.filter((s) => s.id !== id) } : rt)),
          }),
          () => removeRoutineAction(id)
        ),

      // --- Categories ---
      addCategory: (name) => {
        const id = tempId();
        const fd = new FormData();
        fd.set("name", name);
        create(
          (r) => ({ ...r, categories: [...r.categories, { id, name: name.trim() }].sort((a, b) => a.name.localeCompare(b.name)) }),
          () => addCategoryAction(fd),
          (r, realId) => ({ ...r, categories: r.categories.map((c) => (c.id === id ? { ...c, id: realId } : c)) })
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
        }, () => renameCategoryAction(id, fd));
      },
      removeCategory: (id) => mutate((r) => ({ ...r, categories: r.categories.filter((c) => c.id !== id) }), () => removeCategoryAction(id)),

      // --- Voice captures ---
      dismissCapture: (id) => mutate((r) => ({ ...r, captures: r.captures.filter((c) => c.id !== id) }), () => dismissCaptureAction(id)),

      // --- Settings / calendar ---
      setTimeZone: (timeZone) => mutate((r) => ({ ...r, timeZone }), () => updateTimeZoneAction(timeZone)),
      dismissEvent: (eventId) =>
        mutate((r) => ({ ...r, dismissedEventIds: [...r.dismissedEventIds, eventId] }), () => dismissCalendarEventAction(eventId)),
      restoreEvent: (eventId) =>
        mutate(
          (r) => ({ ...r, dismissedEventIds: r.dismissedEventIds.filter((id) => id !== eventId) }),
          () => restoreCalendarEventAction(eventId)
        ),
    };
  }, [router]);

  const data = useMemo<TaskbookData>(
    () => ({ ...serverData, ...deriveEntities(raw, nowMs, mode) }),
    [serverData, raw, nowMs, mode]
  );

  return (
    <TaskbookContext.Provider value={{ data, actions, raw, calendarEvents, nowMs, mode, setMode }}>
      {children}
    </TaskbookContext.Provider>
  );
}
