// Pure date helpers for the Taskbook views. Task/project due dates are stored as UTC
// midnight of the calendar date the user picked (see api.ts's `new Date(dueDateString)`),
// so comparisons here normalize "today" to UTC midnight of the user's local calendar date
// and then compare calendar dates directly — this keeps day-diffs correct regardless of
// the server's timezone.

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// Today's calendar date as a yyyy-mm-dd string, for defaulting <input type="date"> values.
export function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// The calendar date a stored `dueDate` represents (its UTC Y/M/D), as a local Date at
// midnight — safe to format with Intl without a timezone re-shifting it by a day.
export function calendarDateFromDue(due: Date): Date {
  return new Date(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
}

// Whole-day difference between a stored due date and "now", comparing calendar dates only.
export function daysUntil(due: Date, now: Date): number {
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dueUTC = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return Math.round((dueUTC - todayUTC) / 86_400_000);
}

// Same as daysUntil, but for real timestamps (e.g. calendar events) where the local
// calendar day is what matters, not a stored UTC-midnight date.
export function localDaysUntil(d: Date, now: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const MONTH_SHORT = new Intl.DateTimeFormat("en-US", { month: "short" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const MONTH_LONG = new Intl.DateTimeFormat("en-US", { month: "long" });

export function formatShortDate(d: Date): string {
  return `${WEEKDAY_SHORT.format(d)} ${d.getDate()} ${MONTH_SHORT.format(d)}`;
}

export function formatLongDate(d: Date): string {
  return `${WEEKDAY_LONG.format(d)}, ${d.getDate()} ${MONTH_LONG.format(d)}`;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

// A Task's due date, with a clock time appended when one was actually set. Date-only due
// dates are encoded as UTC midnight (see api.ts's combineDueDateTime), so midnight here means
// "no time was specified" rather than a real due time of 00:00.
export function formatDueLabel(due: Date): string {
  const dateLabel = formatShortDate(calendarDateFromDue(due));
  if (due.getUTCHours() === 0 && due.getUTCMinutes() === 0) return dateLabel;
  return `${dateLabel} · ${TIME_FORMAT.format(due)}`;
}

// Due-date clock times are entered in Australia/Perth (UTC+8, no DST — see the notification
// settings question this answers) but stored as a face-value UTC timestamp (api.ts's
// combineDueDateTime comment: typing "18:00" stores 18:00 UTC, not the real UTC instant of
// 18:00 Perth time). PERTH_UTC_OFFSET_MS converts that face value into the real instant it
// represents, so the notification cron fires at the moment the user actually meant.
export const PERTH_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

// The real UTC instant a stored due date represents. Date-only due dates (no time picked)
// default to 8am Perth, whose UTC instant is exactly UTC midnight of that date — already what's
// stored — so only due dates with an explicit time need the offset applied.
export function dueInstant(due: Date): Date {
  const hasExplicitTime = due.getUTCHours() !== 0 || due.getUTCMinutes() !== 0;
  return hasExplicitTime ? new Date(due.getTime() - PERTH_UTC_OFFSET_MS) : due;
}

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export function bucketForDue(due: Date | null, now: Date): DueBucket {
  if (!due) return "none";
  const diff = daysUntil(due, now);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff <= 7) return "week";
  return "later";
}

export type MonthCell = {
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  hasDot: boolean;
};

// Monday-first month grid (matches the design's M T W T F S S header), including leading/
// trailing days from adjacent months for visual continuity. Only `inMonth` cells are ever
// selectable — the design's calendar rail doesn't support navigating to other months.
export function buildMonthCells(year: number, month0: number, todayDay: number, dotDays: Set<number>): MonthCell[] {
  const first = new Date(year, month0, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const prevMonthDays = new Date(year, month0, 0).getDate();
  const mondayIndex = (first.getDay() + 6) % 7; // 0 = Monday
  const totalCells = Math.ceil((mondayIndex + daysInMonth) / 7) * 7;

  const cells: MonthCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const offset = i - mondayIndex;
    if (offset < 0) {
      const day = prevMonthDays + offset + 1;
      cells.push({ key: `prev-${day}`, day, inMonth: false, isToday: false, hasDot: false });
    } else if (offset >= daysInMonth) {
      const day = offset - daysInMonth + 1;
      cells.push({ key: `next-${day}`, day, inMonth: false, isToday: false, hasDot: false });
    } else {
      const day = offset + 1;
      cells.push({ key: `cur-${day}`, day, inMonth: true, isToday: day === todayDay, hasDot: dotDays.has(day) });
    }
  }
  return cells;
}
