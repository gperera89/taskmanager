// Client-safe (NO "server-only") helpers shared by lib/api.ts (server), lib/derive.ts and
// components/taskbook/store.tsx (client). These used to be duplicated per-file with a
// "keep in sync" comment; this is now the single copy.

import type { Habit } from "@prisma/client";
import { zonedNow } from "@/lib/taskbookDates";

export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const ROUTINE_TICK_EXPIRY_MS = 60 * 60 * 1000;

// Due dates are stored as UTC midnight of the chosen calendar date, with a clock time layered
// on top at face value — not a real timezone conversion, just the literal HH:MM the user
// picked, anchored to UTC so the calendar-day math never rolls over.
export function combineDueDateTime(dueDate: string, dueTime?: string | null): Date {
  const time = dueTime && /^\d{2}:\d{2}$/.test(dueTime) ? dueTime : "00:00";
  return new Date(`${dueDate}T${time}:00.000Z`);
}

// The UTC-midnight ms of a stored date's calendar day — for comparing two UTC-midnight-encoded
// dates by calendar day alone (e.g. is the next occurrence past the repeat-until end date).
export function utcCalendarDay(date: Date): number {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// The Prisma shape for "this task doesn't repeat" — every repeat field cleared. `repeatUntil`
// (the series end date) is cleared here too, since it's meaningless without a repeat rule.
export const NO_REPEAT = {
  repeatFrequency: null,
  repeatInterval: null,
  repeatDaysOfWeek: [] as number[],
  repeatMonthlyMode: null,
  repeatDayOfMonth: null,
  repeatMonthlyOrdinal: null,
  repeatMonthlyWeekday: null,
  repeatUntil: null,
};

// --- Habit scheduling / completion math -------------------------------------------------------
//
// A habit's completions are stored one row per completed calendar date (HabitCompletion.date, a
// UTC-midnight-of-the-date value). Everything below works off a Set of `YYYY-MM-DD` day-keys in
// the configured timezone, so the same math runs on the server write and the client's optimistic
// patch without drifting. Weeks are Monday-start; months are calendar months.

type HabitSchedule = Pick<Habit, "scheduleType" | "targetCount" | "daysOfWeek" | "pauseStart" | "pauseEnd">;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// The tz-local calendar fields for an instant. `zonedNow` returns a Date whose UTC getters read
// as the wall clock in the zone, so a UTC-midnight completion date keeps its calendar day here.
function zonedFields(date: Date, timeZone: string): { y: number; m0: number; d: number; weekday: number } {
  const z = zonedNow(date.getTime(), timeZone);
  return { y: z.getUTCFullYear(), m0: z.getUTCMonth(), d: z.getUTCDate(), weekday: z.getUTCDay() };
}

// `YYYY-MM-DD` day-key for an instant, in the configured timezone. String keys compare and sort
// like the dates they represent, so range checks are plain `>=` / `<=` on keys.
export function habitDateKey(date: Date, timeZone: string): string {
  const { y, m0, d } = zonedFields(date, timeZone);
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

// Day-key for a UTC-midnight calendar anchor (used while walking day-by-day in UTC).
function anchorKey(anchorMs: number): string {
  const a = new Date(anchorMs);
  return `${a.getUTCFullYear()}-${pad2(a.getUTCMonth() + 1)}-${pad2(a.getUTCDate())}`;
}

// The current Monday-start week as a [startKey, endKey] inclusive range, given today's tz-local
// fields. anchor = UTC-midnight of today's calendar date; week math is exact integer-day UTC.
function weekRange(now: Date, timeZone: string): { startKey: string; endKey: string; daysLeft: number } {
  const { y, m0, d, weekday } = zonedFields(now, timeZone);
  const anchor = Date.UTC(y, m0, d);
  const fromMonday = (weekday + 6) % 7; // Sun(0)->6, Mon(1)->0, ... Sat(6)->5
  const start = anchor - fromMonday * MS_PER_DAY;
  const end = anchor + (6 - fromMonday) * MS_PER_DAY;
  return { startKey: anchorKey(start), endKey: anchorKey(end), daysLeft: 6 - fromMonday };
}

function monthPrefix(y: number, m0: number): string {
  return `${y}-${pad2(m0 + 1)}-`;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function countInWeek(keys: Set<string>, startKey: string, endKey: string): number {
  let n = 0;
  for (const k of keys) if (k >= startKey && k <= endKey) n++;
  return n;
}

function countInMonth(keys: Set<string>, prefix: string): number {
  let n = 0;
  for (const k of keys) if (k.startsWith(prefix)) n++;
  return n;
}

// The planned-break band as inclusive UTC day-keys (matching toDateInputValue / the heatmap's
// keyOf), or null when no break is set. Endpoints are normalised so start <= end.
function pauseBand(habit: HabitSchedule): { startKey: string; endKey: string } | null {
  if (!habit.pauseStart || !habit.pauseEnd) return null;
  const a = anchorKey(new Date(habit.pauseStart).getTime());
  const b = anchorKey(new Date(habit.pauseEnd).getTime());
  return a <= b ? { startKey: a, endKey: b } : { startKey: b, endKey: a };
}

export type HabitStatus = {
  // Progress within the current period: how many completions vs the target.
  progressDone: number;
  progressTarget: number;
  // "this week" / "this month" — what the target counts against.
  periodLabel: string;
  streak: number;
  isDoneToday: boolean;
  // Current period already at/over target.
  isPeriodMet: boolean;
  // Behind pace with little time left in the period (flame flickers).
  atRisk: boolean;
  // Fallen off entirely — nothing this period and no live streak (flame out).
  lapsed: boolean;
};

// The one place habit status is computed, from a Set of tz-local day-keys. Used by both derive
// (client view-models) and any server-side status need.
export function habitStatus(habit: HabitSchedule, completionKeys: Set<string>, now: Date, timeZone: string): HabitStatus {
  const todayKey = habitDateKey(now, timeZone);
  const isDoneToday = completionKeys.has(todayKey);
  const { y, m0, d, weekday } = zonedFields(now, timeZone);

  // Planned break: scheduled days inside the band are neither counted nor treated as misses, so
  // an intentional holiday doesn't break the streak or flag the habit at-risk/lapsed.
  const band = pauseBand(habit);
  const inBand = (k: string) => band != null && k >= band.startKey && k <= band.endKey;
  const todayPaused = inBand(todayKey);

  if (habit.scheduleType === "MONTHLY_COUNT") {
    const target = Math.max(1, habit.targetCount);
    const done = countInMonth(completionKeys, monthPrefix(y, m0));
    const daysLeft = daysInMonth(y, m0) - d;
    const isPeriodMet = done >= target;
    // Walk back over prior months (skipping any month wholly inside a planned break).
    let streak = isPeriodMet ? 1 : 0;
    let py = y;
    let pm = m0;
    for (let i = 0; i < 240; i++) {
      pm -= 1;
      if (pm < 0) { pm = 11; py -= 1; }
      const firstKey = `${py}-${pad2(pm + 1)}-01`;
      const lastKey = `${py}-${pad2(pm + 1)}-${pad2(daysInMonth(py, pm))}`;
      if (inBand(firstKey) && inBand(lastKey)) continue;
      if (countInMonth(completionKeys, monthPrefix(py, pm)) >= target) streak++;
      else break;
    }
    return {
      progressDone: done,
      progressTarget: target,
      periodLabel: "this month",
      streak,
      isDoneToday,
      isPeriodMet,
      atRisk: !todayPaused && !isPeriodMet && target - done > daysLeft,
      lapsed: !todayPaused && !isPeriodMet && done === 0,
    };
  }

  // Weekly modes (WEEKLY_DAYS / WEEKLY_COUNT) both key off the Monday-start week.
  const { startKey, endKey, daysLeft } = weekRange(now, timeZone);
  const doneThisWeek = countInWeek(completionKeys, startKey, endKey);

  if (habit.scheduleType === "WEEKLY_DAYS") {
    const scheduled = habit.daysOfWeek;
    const target = Math.max(1, scheduled.length);
    const todayScheduled = scheduled.includes(weekday);
    // Streak: walk scheduled days backward from today. A missed *past* scheduled day breaks it;
    // today missed is just "in progress" (grace).
    const anchor = Date.UTC(y, m0, d);
    let streak = 0;
    for (let i = 0; i < 800; i++) {
      const cursorMs = anchor - i * MS_PER_DAY;
      const wd = new Date(cursorMs).getUTCDay();
      if (!scheduled.includes(wd)) continue;
      const key = anchorKey(cursorMs);
      if (inBand(key)) continue; // planned break — skip without counting or breaking
      if (completionKeys.has(key)) streak++;
      else if (key === todayKey) continue; // today not done yet — don't break the streak
      else break;
    }
    const isPeriodMet = doneThisWeek >= target;
    return {
      progressDone: doneThisWeek,
      progressTarget: target,
      periodLabel: "this week",
      streak,
      isDoneToday,
      isPeriodMet,
      atRisk: todayScheduled && !isDoneToday && !todayPaused,
      lapsed: streak === 0 && !isDoneToday && !todayPaused,
    };
  }

  // WEEKLY_COUNT
  const target = Math.max(1, habit.targetCount);
  const isPeriodMet = doneThisWeek >= target;
  let streak = isPeriodMet ? 1 : 0;
  // Walk back over prior weeks.
  const anchor = Date.UTC(y, m0, d);
  const fromMonday = (weekday + 6) % 7;
  let weekStartMs = anchor - fromMonday * MS_PER_DAY;
  for (let i = 0; i < 400; i++) {
    weekStartMs -= 7 * MS_PER_DAY;
    const sKey = anchorKey(weekStartMs);
    const eKey = anchorKey(weekStartMs + 6 * MS_PER_DAY);
    if (inBand(sKey) && inBand(eKey)) continue; // whole week inside a planned break — skip
    if (countInWeek(completionKeys, sKey, eKey) >= target) streak++;
    else break;
  }
  return {
    progressDone: doneThisWeek,
    progressTarget: target,
    periodLabel: "this week",
    streak,
    isDoneToday,
    isPeriodMet,
    atRisk: !todayPaused && !isPeriodMet && target - doneThisWeek > daysLeft + 1,
    lapsed: !todayPaused && !isPeriodMet && doneThisWeek === 0 && streak === 0,
  };
}

// The flame's visual state, mirroring the old lit/flicker/out semantics.
export function habitFlameState(status: HabitStatus): "lit" | "flicker" | "out" {
  if (status.lapsed) return "out";
  if (status.atRisk) return "flicker";
  return "lit";
}

// --- Countdown occurrence math ----------------------------------------------------------------
//
// Shared by derive.ts (the calendar-rail list) and notifications.ts (the cron pushes) so both
// agree on which occurrence a countdown is heading toward. `date` uses the UTC-midnight
// calendar-date encoding; `todayUtcMs` is UTC midnight of today's calendar date in the
// configured timezone (see derive's zonedToday).

// The UTC-midnight ms of the next occurrence: the date itself for one-offs (even if past —
// callers filter/sweep those), or the next anniversary of the month/day for yearly countdowns.
export function nextCountdownOccurrenceMs(date: Date, repeatsYearly: boolean, todayUtcMs: number): number {
  const d = new Date(date);
  if (!repeatsYearly) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const year = new Date(todayUtcMs).getUTCFullYear();
  const thisYear = Date.UTC(year, d.getUTCMonth(), d.getUTCDate());
  return thisYear >= todayUtcMs ? thisYear : Date.UTC(year + 1, d.getUTCMonth(), d.getUTCDate());
}

// Whole years between the original date and an occurrence of it — the "42" in "42 years".
export function countdownYears(date: Date, occurrenceMs: number): number {
  return new Date(occurrenceMs).getUTCFullYear() - new Date(date).getUTCFullYear();
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
