import type { RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";

export type TaskRepeatRule = {
  frequency: RoutineFrequency;
  interval: number;
  daysOfWeek: number[];
  monthlyMode: RoutineMonthlyMode;
  dayOfMonth: number | null;
  monthlyOrdinal: number | null;
  monthlyWeekday: number | null;
};

function addUTC(due: Date, days: number): Date {
  return new Date(
    Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate() + days, due.getUTCHours(), due.getUTCMinutes())
  );
}

// Same calendar day next month(s), clamped to the shortest month if it doesn't have that day
// (e.g. the 31st + 1 month from Jan lands on the last day of Feb, not March 3rd).
function addMonthsClampedUTC(due: Date, months: number, day: number): Date {
  const targetMonthIndex = due.getUTCMonth() + months;
  const daysInTargetMonth = new Date(Date.UTC(due.getUTCFullYear(), targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(due.getUTCFullYear(), targetMonthIndex, Math.min(day, daysInTargetMonth), due.getUTCHours(), due.getUTCMinutes())
  );
}

// The nth (or last) occurrence of `weekday` in the given UTC month.
function nthWeekdayOfMonthUTC(year: number, month: number, weekday: number, ordinal: number, hours: number, minutes: number): Date {
  if (ordinal === -1) {
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let d = lastDay; d >= lastDay - 6; d--) {
      if (new Date(Date.UTC(year, month, d)).getUTCDay() === weekday) return new Date(Date.UTC(year, month, d, hours, minutes));
    }
  }
  const firstDayWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstMatch = 1 + ((weekday - firstDayWeekday + 7) % 7);
  return new Date(Date.UTC(year, month, firstMatch + (ordinal - 1) * 7, hours, minutes));
}

// The next occurrence of a repeating task's due date, given it was just completed at `due`.
// Weekly with specific days steps to the next selected weekday within the week, or wraps to
// the first selected day `interval` weeks out once the week's days are exhausted.
export function nextOccurrence(due: Date, rule: TaskRepeatRule): Date {
  const interval = rule.interval > 0 ? rule.interval : 1;

  if (rule.frequency === "DAILY") return addUTC(due, interval);

  if (rule.frequency === "WEEKLY") {
    if (rule.daysOfWeek.length === 0) return addUTC(due, interval * 7);
    const dow = due.getUTCDay();
    const sorted = [...rule.daysOfWeek].sort((a, b) => a - b);
    const next = sorted.find((d) => d > dow);
    if (next !== undefined) return addUTC(due, next - dow);
    const daysUntilFirstNextCycle = 7 - dow + sorted[0] + (interval - 1) * 7;
    return addUTC(due, daysUntilFirstNextCycle);
  }

  // MONTHLY
  if (rule.monthlyMode === "WEEKDAY" && rule.monthlyOrdinal != null && rule.monthlyWeekday != null) {
    const targetMonth = due.getUTCMonth() + interval;
    const year = due.getUTCFullYear() + Math.floor(targetMonth / 12);
    const month = ((targetMonth % 12) + 12) % 12;
    return nthWeekdayOfMonthUTC(year, month, rule.monthlyWeekday, rule.monthlyOrdinal, due.getUTCHours(), due.getUTCMinutes());
  }
  const day = rule.dayOfMonth === -1 ? 31 : rule.dayOfMonth ?? due.getUTCDate();
  return addMonthsClampedUTC(due, interval, day);
}

// Whether `weekday` on `date` is the ordinal-th occurrence of that weekday in its month
// (ordinal -1 means "the last one").
function nthWeekdayMatches(date: Date, weekday: number, ordinal: number): boolean {
  if (date.getUTCDay() !== weekday) return false;
  if (ordinal === -1) {
    const daysLeftInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate() - date.getUTCDate();
    return daysLeftInMonth < 7;
  }
  return Math.ceil(date.getUTCDate() / 7) === ordinal;
}

// Whether a routine's recurrence pattern lands on `at`'s calendar day. `at` should be a
// Perth-wall-clock instant (see notifications.ts / PERTH_UTC_OFFSET_MS) whose UTC getters are
// read as the local calendar day/weekday, matching the face-value-as-UTC convention used
// throughout this codebase. Ignores `interval`: unlike Task's nextOccurrence (which rolls
// forward from a concrete previous due date), routines have no anchor date to count cycles
// from, so "every 2 weeks" and "every week" both just mean "on these days" for due-today checks.
export function isRoutineDueToday(rule: TaskRepeatRule, at: Date): boolean {
  if (rule.frequency === "DAILY") return true;
  if (rule.frequency === "WEEKLY") {
    return rule.daysOfWeek.length === 0 || rule.daysOfWeek.includes(at.getUTCDay());
  }
  if (rule.monthlyMode === "WEEKDAY" && rule.monthlyOrdinal != null && rule.monthlyWeekday != null) {
    return nthWeekdayMatches(at, rule.monthlyWeekday, rule.monthlyOrdinal);
  }
  if (rule.dayOfMonth === -1) {
    return at.getUTCDate() === new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
  }
  return rule.dayOfMonth === at.getUTCDate();
}

// Mirrors api.ts's resolveRoutineRecurrence: nulls out whichever recurrence fields don't apply
// to the chosen frequency/monthlyMode so stale values from a previous edit never linger.
export function resolveTaskRepeat(input: {
  frequency: RoutineFrequency;
  interval?: number;
  daysOfWeek?: number[];
  monthlyMode?: RoutineMonthlyMode;
  dayOfMonth?: number | null;
  monthlyOrdinal?: number | null;
  monthlyWeekday?: number | null;
}) {
  const interval = input.interval && input.interval > 0 ? Math.floor(input.interval) : 1;
  const monthlyMode = input.monthlyMode ?? "DATE";

  return {
    repeatFrequency: input.frequency,
    repeatInterval: interval,
    repeatDaysOfWeek: input.frequency === "WEEKLY" ? input.daysOfWeek ?? [] : [],
    repeatMonthlyMode: input.frequency === "MONTHLY" ? monthlyMode : null,
    repeatDayOfMonth: input.frequency === "MONTHLY" && monthlyMode === "DATE" ? input.dayOfMonth ?? null : null,
    repeatMonthlyOrdinal: input.frequency === "MONTHLY" && monthlyMode === "WEEKDAY" ? input.monthlyOrdinal ?? null : null,
    repeatMonthlyWeekday: input.frequency === "MONTHLY" && monthlyMode === "WEEKDAY" ? input.monthlyWeekday ?? null : null,
  };
}

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDINAL_WORDS: Record<number, string> = { 1: "First", 2: "Second", 3: "Third", 4: "Fourth", 5: "Fifth", [-1]: "Last" };

function intervalWord(n: number, unit: string): string {
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

// Short label for the row, e.g. "Every week · Mon, Wed" or "Every 2 months · 15th".
export function describeTaskRepeat(rule: TaskRepeatRule): string {
  if (rule.frequency === "DAILY") return intervalWord(rule.interval, "day");
  if (rule.frequency === "WEEKLY") {
    const weekPart = intervalWord(rule.interval, "week");
    const days = rule.daysOfWeek.length
      ? [...rule.daysOfWeek].sort((a, b) => a - b).map((d) => WEEKDAY_ABBR[d]).join(", ")
      : "";
    return days ? `${weekPart} · ${days}` : weekPart;
  }
  const monthPart = intervalWord(rule.interval, "month");
  if (rule.monthlyMode === "WEEKDAY" && rule.monthlyOrdinal != null && rule.monthlyWeekday != null) {
    return `${monthPart} · ${ORDINAL_WORDS[rule.monthlyOrdinal] ?? rule.monthlyOrdinal} ${WEEKDAY_ABBR[rule.monthlyWeekday]}`;
  }
  if (rule.dayOfMonth === -1) return `${monthPart} · Last day`;
  return rule.dayOfMonth ? `${monthPart} · ${rule.dayOfMonth}${daySuffix(rule.dayOfMonth)}` : monthPart;
}

function daySuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
