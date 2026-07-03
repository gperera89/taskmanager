// Pure date helpers for the Taskbook views. Task/project due dates are stored as UTC
// midnight of the calendar date the user picked (see api.ts's `new Date(dueDateString)`),
// so comparisons here normalize "today" to UTC midnight of the user's local calendar date
// and then compare calendar dates directly — this keeps day-diffs correct regardless of
// the server's timezone.

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
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
