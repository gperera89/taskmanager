// Mirrors the ICS sync's shape (lib/calendar.ts, which is "server-only" and re-exports this
// type rather than defining it, since derive.ts needs it and can't import server-only code).
export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  source: string;
};

export type TaskItemVM = {
  id: string;
  title: string;
  isCompleted: boolean;
  category: string;
  description: string | null;
  dueDateValue: string; // yyyy-mm-dd for the edit form's <input type="date">, "" if none
  dueTimeValue: string; // HH:MM for the edit form's <input type="time">, "" if no time set
  dueLabel: string | null; // e.g. "Fri 3 Jul" or "Fri 3 Jul · 6:00 PM" when a time is set
  projectId: string | null;
  projectName: string | null;
  subtasksDone: number;
  subtasksTotal: number;
  repeatFrequency: "DAILY" | "WEEKLY" | "MONTHLY" | null; // null = does not repeat
  repeatInterval: number;
  repeatDaysOfWeek: number[];
  repeatMonthlyMode: "DATE" | "WEEKDAY";
  repeatDayOfMonth: number | null;
  repeatMonthlyOrdinal: number | null;
  repeatMonthlyWeekday: number | null;
  repeatLabel: string | null; // e.g. "Every week · Mon, Wed", null when repeatFrequency is null
};

export type TaskGroupVM = {
  key: string;
  label: string;
  tasks: TaskItemVM[];
};

export type ProjectCardVM = {
  id: string;
  name: string;
  description: string | null;
  dueDateValue: string;
  dueLabel: string | null;
  done: number;
  total: number;
  progressPct: number;
  preview: TaskItemVM[];
  moreCount: number;
};

export type HabitIntervalUnit = "DAY" | "WEEK" | "MONTH";

export type HabitCardVM = {
  id: string;
  title: string;
  intervalValue: number;
  intervalUnit: HabitIntervalUnit;
  currentStreak: number;
  longestStreak: number;
  atRisk: boolean;
  isDoneThisPeriod: boolean;
  detailLabel: string;
};

export type SubroutineVM = { id: string; title: string };

export type RoutineItemVM = {
  id: string;
  title: string;
  reminderTime: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  daysOfWeek: number[];
  monthlyMode: "DATE" | "WEEKDAY";
  dayOfMonth: number | null;
  monthlyOrdinal: number | null;
  monthlyWeekday: number | null;
  isActive: boolean;
  isTicked: boolean;
  scheduleLabel: string;
  pausedUntil: string; // yyyy-mm-dd for the date-input, "" if not paused
  nextNotificationLabel: string; // e.g. "tomorrow" or "Mon 14 Jul"
  // Grouped under this routine so they fire as one clustered notification and tick off
  // together, e.g. "Wake Up Routine" -> "Make coffee", "Brush teeth", "Shave".
  subroutines: SubroutineVM[];
};

export type DayDetailVM = {
  day: number;
  weekday: string;
  dateLabel: string;
  tasks: { id: string; title: string; isCompleted: boolean; projectName: string | null }[];
  projects: { id: string; name: string }[];
  events: { id: string; title: string; metaLabel: string; allDay: boolean }[];
};

export type UpcomingItemVM = {
  key: string;
  a: string;
  b: string;
  c: string;
  hasC: boolean;
};

export type ProjectOption = { id: string; name: string };
export type CategoryOption = { id: string; name: string };

export type CapturedKind = "task" | "project" | "routine" | "habit";

export type VoiceCaptureVM = {
  id: string;
  transcript: string;
  kind: CapturedKind;
  entityId: string;
  summary: string;
  parseError: boolean;
};

// The calendar view (monthLabel/year/monthCells/dayDetails/upcoming) is NOT part of this type —
// it's computed separately by deriveCalendarView (lib/derive.ts) and owned by TaskbookApp, since
// it depends on the viewed month, which this store doesn't track (see CalendarViewVM).
export type TaskbookData = {
  todayLabel: string;
  taskGroups: TaskGroupVM[];
  tasksRemainingToday: number;
  projectCards: ProjectCardVM[];
  activeProjectCount: number;
  routineDaily: RoutineItemVM[];
  routineScheduled: RoutineItemVM[];
  routineTotalCount: number;
  habitFeatured: HabitCardVM | null;
  habitSuggested: HabitCardVM[];
  habitOnTrack: HabitCardVM[];
  habitAtRiskCount: number;
  calendarErrors: string[];
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  pendingCaptures: VoiceCaptureVM[];
};

export type AreaKey = "tasks" | "projects" | "routines" | "habits" | "calendar" | "day";

// Global visibility filter (top-right toggle): which calendar(s)/tasks are shown. "work"/
// "personal" match against Task.category (case-insensitively) and the ICS event's `source`
// label ("Outlook" is the YCIS work calendar, "Gmail" is the personal one) — see deriveEntities/
// deriveCalendarView in lib/derive.ts.
export type Mode = "work" | "personal" | "all";

export type ItemKind = "task" | "project" | "routine" | "habit";

// Tasks are edited inline on their row (see TasksView) rather than through this modal.
export type ModalState =
  | { mode: "add"; initialKind?: ItemKind }
  | { mode: "edit"; kind: "project"; item: ProjectCardVM }
  | { mode: "edit"; kind: "routine"; item: RoutineItemVM }
  | { mode: "edit"; kind: "habit"; item: HabitCardVM }
  | null;
