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

// --- Configurable timezone (replaces the old hardcoded "Perth" +8h assumption) ---
//
// Due/reminder clock times are entered as a face value (e.g. typing "18:00" stores 18:00 UTC,
// not the real UTC instant of 18:00 in any zone — see api.ts's combineDueDateTime comment) that
// is meant to be interpreted in the app's *configured* timezone (AppSettings.timeZone), not a
// fixed offset. The default zone (China, UTC+8, no DST) is arithmetically identical to the old
// hardcoded Perth offset, so behavior is unchanged unless the user switches zones in Settings.

export const CHINA_TIME_ZONE = "Asia/Shanghai";
export const DEFAULT_TIME_ZONE = CHINA_TIME_ZONE;

export const SUPPORTED_TIME_ZONES: { id: string; label: string }[] = [
  { id: CHINA_TIME_ZONE, label: "Shanghai" },
  { id: "Australia/Melbourne", label: "Melbourne" },
  { id: "Australia/Brisbane", label: "Brisbane" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

// Less-frequently-needed zones for travel — surfaced via a dropdown rather than the main row of
// buttons, so the common four stay one tap away while these stay reachable without cluttering it.
export const OTHER_TIME_ZONES: { id: string; label: string }[] = [
  { id: "Australia/Perth", label: "Perth" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Jakarta", label: "Jakarta" },
  { id: "Asia/Manila", label: "Manila" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Pacific/Honolulu", label: "Honolulu" },
];

// A zone's real (DST-aware) UTC offset, in ms, at a given instant — the standard
// Intl.DateTimeFormat formatToParts trick, since Intl already carries the IANA tz database.
export function getTimeZoneOffsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - at.getTime();
}

// "UTC+8" / "UTC-4:30" — for labelling zone pickers. Takes an offset (not a zone id) so callers
// that already have one from getTimeZoneOffsetMs don't recompute it.
export function formatUtcOffset(offsetMs: number): string {
  const totalMinutes = Math.round(offsetMs / 60_000);
  const sign = totalMinutes < 0 ? "-" : "+";
  const abs = Math.abs(totalMinutes);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `UTC${sign}${hh}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
}

// A Date whose UTC getters read as the current wall clock in `timeZone` — generalizes the old
// "perthNow" helpers duplicated in derive.ts/notifications.ts. Matches the face-value-as-UTC
// convention used for due dates and Routine reminderTime strings throughout this codebase.
export function zonedNow(nowMs: number, timeZone: string): Date {
  return new Date(nowMs + getTimeZoneOffsetMs(new Date(nowMs), timeZone));
}

// Converts a face-value wall-clock Date (UTC getters = the intended Y/M/D HH:MM in `timeZone`)
// into the real UTC instant it represents. Two-pass refinement handles DST-transition edges
// (the offset can differ slightly between the naive guess and the resolved instant).
function zonedWallClockToInstant(faceValueUtc: Date, timeZone: string): Date {
  let instantMs = faceValueUtc.getTime();
  for (let i = 0; i < 2; i++) {
    const offset = getTimeZoneOffsetMs(new Date(instantMs), timeZone);
    instantMs = faceValueUtc.getTime() - offset;
  }
  return new Date(instantMs);
}

// The real UTC instant a stored due date represents, in `timeZone`. Date-only due dates (no
// time picked) default to 8am in that zone — matching the implicit "8am" default this always
// had — everything else uses the literal typed HH:MM.
export function dueInstant(due: Date, timeZone: string): Date {
  const hasExplicitTime = due.getUTCHours() !== 0 || due.getUTCMinutes() !== 0;
  const hh = hasExplicitTime ? due.getUTCHours() : 8;
  const mm = hasExplicitTime ? due.getUTCMinutes() : 0;
  const faceValue = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), hh, mm));
  return zonedWallClockToInstant(faceValue, timeZone);
}

// The calendar day (in `timeZone`) a real instant falls on — for bucketing calendar (ICS)
// events, whose timestamps are real UTC instants, into the right day/month for the *viewed*
// zone rather than whatever zone the server process happens to run in.
export function zonedYMD(at: Date, timeZone: string): { year: number; month0: number; day: number } {
  const z = zonedNow(at.getTime(), timeZone);
  return { year: z.getUTCFullYear(), month0: z.getUTCMonth(), day: z.getUTCDate() };
}

// `at`'s calendar day in `timeZone`, as a local midnight Date — safe to feed into
// formatShortDate/formatLongDate the same way calendarDateFromDue's local Dates are.
export function zonedCalendarDate(at: Date, timeZone: string): Date {
  const { year, month0, day } = zonedYMD(at, timeZone);
  return new Date(year, month0, day);
}

// Same as localDaysUntil, but comparing calendar days in `timeZone` instead of the runtime's
// own local timezone — for calendar (ICS) events, whose real UTC instants need to be judged
// against whichever zone the user has selected in Settings.
export function zonedDaysUntil(d: Date, now: Date, timeZone: string): number {
  const a = zonedCalendarDate(d, timeZone).getTime();
  const b = zonedCalendarDate(now, timeZone).getTime();
  return Math.round((a - b) / 86_400_000);
}

const EVENT_TIME_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();
function eventTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = EVENT_TIME_FORMAT_CACHE.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
    EVENT_TIME_FORMAT_CACHE.set(timeZone, fmt);
  }
  return fmt;
}

// A timed calendar event's clock time in `timeZone`, with the China-time equivalent appended in
// brackets whenever the selected zone isn't China itself (so a non-Chinese-zone user always has
// a China-time reference point, per the settings requirement).
export function formatEventTime(startIso: string, timeZone: string): string {
  const d = new Date(startIso);
  const primary = eventTimeFormatter(timeZone).format(d);
  if (timeZone === CHINA_TIME_ZONE) return primary;
  const china = eventTimeFormatter(CHINA_TIME_ZONE).format(d);
  return `${primary} (${china} CN)`;
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
// trailing days from adjacent months for visual continuity. `today` is the real current
// year/month0/day (independent of which month is being viewed) so "is this actually today" is
// correct even when the user has navigated to a different month via the prev/next arrows.
export function buildMonthCells(
  year: number,
  month0: number,
  today: { year: number; month0: number; day: number },
  dotDays: Set<number>
): MonthCell[] {
  const first = new Date(year, month0, 1);
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const prevMonthDays = new Date(year, month0, 0).getDate();
  const mondayIndex = (first.getDay() + 6) % 7; // 0 = Monday
  const totalCells = Math.ceil((mondayIndex + daysInMonth) / 7) * 7;
  const isCurrentMonth = year === today.year && month0 === today.month0;

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
      cells.push({ key: `cur-${day}`, day, inMonth: true, isToday: isCurrentMonth && day === today.day, hasDot: dotDays.has(day) });
    }
  }
  return cells;
}
