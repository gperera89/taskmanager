// Client-safe (NO "server-only") helpers shared by lib/api.ts (server), lib/derive.ts and
// components/taskbook/store.tsx (client). These used to be duplicated per-file with a
// "keep in sync" comment; this is now the single copy.

import type { Habit } from "@prisma/client";
import { getTimeZoneOffsetMs } from "@/lib/taskbookDates";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const ROUTINE_TICK_EXPIRY_MS = 60 * 60 * 1000;

// Approximate window length used to judge whether a completion keeps the streak alive. Months
// aren't calendar-aware — a 30-day window is close enough for streak bucketing purposes.
export const INTERVAL_UNIT_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30 };

// Due dates are stored as UTC midnight of the chosen calendar date, with a clock time layered
// on top at face value — not a real timezone conversion, just the literal HH:MM the user
// picked, anchored to UTC so the calendar-day math never rolls over.
export function combineDueDateTime(dueDate: string, dueTime?: string | null): Date {
  const time = dueTime && /^\d{2}:\d{2}$/.test(dueTime) ? dueTime : "00:00";
  return new Date(`${dueDate}T${time}:00.000Z`);
}

// The Prisma shape for "this task doesn't repeat" — every repeat field cleared.
export const NO_REPEAT = {
  repeatFrequency: null,
  repeatInterval: null,
  repeatDaysOfWeek: [] as number[],
  repeatMonthlyMode: null,
  repeatDayOfMonth: null,
  repeatMonthlyOrdinal: null,
  repeatMonthlyWeekday: null,
};

export function habitWindowDays(habit: Pick<Habit, "intervalValue" | "intervalUnit">): number {
  return habit.intervalValue * (INTERVAL_UNIT_DAYS[habit.intervalUnit] ?? 1);
}

// Periods are windowDays-long buckets of *calendar days in the configured timezone* since the
// epoch. The old version bucketed raw epoch time, so a daily habit's boundary sat at UTC
// midnight (8am in a UTC+8 zone) — completing at 7:50am and 8:10am local counted as two
// different days. Shifting by the zone offset first makes the boundary local midnight.
export function habitPeriodIndex(date: Date, windowDays: number, timeZone: string): number {
  const ms = date.getTime() + getTimeZoneOffsetMs(date, timeZone);
  return Math.floor(ms / (MS_PER_DAY * windowDays));
}

// The real instant the current habit period rolls over (local-midnight-aligned, see above).
export function habitPeriodEndMs(nowPeriod: number, windowDays: number, now: Date, timeZone: string): number {
  return (nowPeriod + 1) * windowDays * MS_PER_DAY - getTimeZoneOffsetMs(now, timeZone);
}

export type HabitCompletionResult = {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: Date;
} | null; // null = already done this period, nothing to write

// One shared implementation of "mark done now" streak math, used by the server write
// (api.completeHabit) and the optimistic patch (store.markHabitDone) so they can never drift.
export function computeHabitCompletion(
  habit: Pick<Habit, "intervalValue" | "intervalUnit" | "currentStreak" | "longestStreak" | "lastCompletedDate">,
  now: Date,
  timeZone: string
): HabitCompletionResult {
  const windowDays = habitWindowDays(habit);
  const nowPeriod = habitPeriodIndex(now, windowDays, timeZone);

  let currentStreak: number;
  if (!habit.lastCompletedDate) {
    currentStreak = 1;
  } else {
    const lastPeriod = habitPeriodIndex(new Date(habit.lastCompletedDate), windowDays, timeZone);
    if (nowPeriod === lastPeriod) return null;
    currentStreak = nowPeriod === lastPeriod + 1 ? habit.currentStreak + 1 : 1;
  }
  return {
    currentStreak,
    longestStreak: Math.max(habit.longestStreak, currentStreak),
    lastCompletedDate: now,
  };
}

export type HabitPeriodStatus = {
  windowDays: number;
  isDoneThisPeriod: boolean;
  daysRemaining: number;
  periodEndsAtMs: number;
  // True when the streak is already broken (a gap of more than one period), so the next
  // completion resets to 1 rather than extending.
  lapsed: boolean;
  atRisk: boolean;
};

export function habitPeriodStatus(
  habit: Pick<Habit, "intervalValue" | "intervalUnit" | "lastCompletedDate">,
  now: Date,
  timeZone: string
): HabitPeriodStatus {
  const windowDays = habitWindowDays(habit);
  const nowPeriod = habitPeriodIndex(now, windowDays, timeZone);
  const lastPeriod = habit.lastCompletedDate
    ? habitPeriodIndex(new Date(habit.lastCompletedDate), windowDays, timeZone)
    : null;
  const periodEndsAtMs = habitPeriodEndMs(nowPeriod, windowDays, now, timeZone);
  const isDoneThisPeriod = lastPeriod === nowPeriod;
  const daysRemaining = (periodEndsAtMs - now.getTime()) / MS_PER_DAY;
  const lapsed = !isDoneThisPeriod && (lastPeriod == null || nowPeriod - lastPeriod > 1);
  return { windowDays, isDoneThisPeriod, daysRemaining, periodEndsAtMs, lapsed, atRisk: !isDoneThisPeriod && daysRemaining <= 1 };
}

// Sort key for manual ordering: manually-positioned tasks first (by their fractional index),
// then unpositioned ones by due time, then by creation time. Used identically by the tasks
// view buckets and project-card sections.
export function taskOrderCompare(
  a: { sortOrder: number | null; dueMs: number | null; createdMs: number },
  b: { sortOrder: number | null; dueMs: number | null; createdMs: number }
): number {
  const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  const ad = a.dueMs ?? Number.MAX_SAFE_INTEGER;
  const bd = b.dueMs ?? Number.MAX_SAFE_INTEGER;
  if (ad !== bd) return ad - bd;
  return a.createdMs - b.createdMs;
}

// Reminder lead options shared by the task/project forms and the inline due editor.
export const REMINDER_LEAD_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "At due time" },
  { value: 10, label: "10 min before" },
  { value: 30, label: "30 min before" },
  { value: 60, label: "1 hour before" },
  { value: 240, label: "4 hours before" },
  { value: 1440, label: "1 day before" },
];

// Preset duration labels offered in the datalist dropdown on every add/edit form. The field is
// a free-text box, so these are just suggestions — a custom value like "20 min" is also allowed.
// Each label must round-trip through parseDurationInput/formatDuration below.
export const DURATION_OPTIONS = ["5 min", "10 min", "15 min", "30 min", "45 min", "1 hour", "1.5 hours"] as const;

// Parses a free-text duration into whole minutes. Accepts a bare number (minutes), or hour/
// minute units in most spellings: "45 min", "1h", "1.5 hours", "1h 30m". Returns null for
// empty/unparseable input or a non-positive result (so an empty box clears the field).
export function parseDurationInput(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // Bare number = minutes ("30" -> 30).
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.round(parseFloat(s));
    return n > 0 ? n : null;
  }
  let total = 0;
  let matched = false;
  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (hourMatch) {
    total += parseFloat(hourMatch[1]) * 60;
    matched = true;
  }
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (minMatch) {
    total += parseFloat(minMatch[1]);
    matched = true;
  }
  if (!matched) return null;
  const rounded = Math.round(total);
  return rounded > 0 ? rounded : null;
}

// Formats whole minutes back into a human label for display and for pre-filling the edit box.
// Chosen so the presets and half-hours round-trip exactly (90 -> "1.5 hours" -> 90).
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  if (m === 30) return `${h}.5 hours`;
  return `${h}h ${m}m`;
}
