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
  section: string | null; // grouping heading within a project card
  sortOrder: number | null; // manual position within its bucket/section (fractional index)
  reminderLeadMinutes: number | null; // notify this long before the due time (null = at it)
  durationMinutes: number | null; // expected time to complete, in minutes (null = unset)
  durationLabel: string | null; // e.g. "30 min" or "1.5 hours", null when unset
  subtasks: SubtaskVM[];
};

export type SubtaskVM = {
  id: string;
  title: string;
  isCompleted: boolean;
};

export type TaskGroupVM = {
  key: string;
  label: string;
  tasks: TaskItemVM[];
};

export type ProjectSectionVM = {
  name: string | null; // null = the unsectioned group (rendered without a heading)
  tasks: TaskItemVM[];
};

export type ProjectCardVM = {
  id: string;
  name: string;
  description: string | null;
  dueDateValue: string;
  dueLabel: string | null;
  reminderLeadMinutes: number | null;
  durationMinutes: number | null;
  durationLabel: string | null;
  done: number;
  total: number;
  progressPct: number;
  tasks: TaskItemVM[]; // all tasks in the project, incomplete first (flat, for lookups)
  sections: ProjectSectionVM[]; // the same tasks grouped by section for display
  sectionNames: string[]; // existing section names, for the per-task section picker
};

export type HabitScheduleType = "WEEKLY_DAYS" | "WEEKLY_COUNT" | "MONTHLY_COUNT";

export type HabitCardVM = {
  id: string;
  title: string;
  scheduleType: HabitScheduleType;
  targetCount: number;
  daysOfWeek: number[];
  streak: number;
  atRisk: boolean;
  lapsed: boolean;
  isDoneToday: boolean;
  // Progress within the current period, shown as "done/target" beside the flame.
  progressDone: number;
  progressTarget: number;
  detailLabel: string;
  // YYYY-MM-DD keys of every completed day (up to a year back) — feeds the heatmap.
  completedDates: string[];
  durationMinutes: number | null;
  durationLabel: string | null;
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
  durationMinutes: number | null;
  durationLabel: string | null;
  isActive: boolean;
  isTicked: boolean;
  scheduleLabel: string;
  pausedUntil: string; // yyyy-mm-dd for the date-input, "" if not paused
  nextNotificationLabel: string; // e.g. "tomorrow" or "Mon 14 Jul"
  nextOccurrenceMs: number; // sort key for the chronological routines list
  // Grouped under this routine so they fire as one clustered notification and tick off
  // together, e.g. "Wake Up Routine" -> "Make coffee", "Brush teeth", "Shave".
  subroutines: SubroutineVM[];
};

export type DayDetailVM = {
  day: number;
  weekday: string;
  dateLabel: string;
  fullLabel: string;
  tasks: { id: string; title: string; isCompleted: boolean; projectName: string | null }[];
  projects: { id: string; name: string }[];
  events: { id: string; title: string; metaLabel: string; allDay: boolean; source: string }[];
  // Events dismissed for this specific day, kept around (title only) so the day heading can
  // offer a "N dismissed · Restore" affordance without re-fetching anything.
  dismissedEvents: { id: string; title: string }[];
};

export type UpcomingItemVM = {
  key: string;
  a: string;
  b: string;
  c: string;
  hasC: boolean;
};

export type ProjectOption = { id: string; name: string };
export type CategoryScopeOption = "WORK" | "HOME" | "NONE";
export type CategoryOption = { id: string; name: string; scope: CategoryScopeOption };

export type CapturedKind = "task" | "project" | "routine" | "habit";

export type CaptureSource = "voice" | "email";

export type VoiceCaptureVM = {
  id: string;
  transcript: string;
  kind: CapturedKind;
  entityId: string;
  summary: string;
  source: CaptureSource;
  parseError: boolean;
};

// The calendar view (monthLabel/year/monthCells/dayDetails/upcoming) is NOT part of this type —
// it's computed separately by deriveCalendarView (lib/derive.ts) and owned by TaskbookApp, since
// it depends on the viewed month, which this store doesn't track (see CalendarViewVM).
export type TaskbookData = {
  todayLabel: string;
  // AppSettings.lastCronAt as ms (null = never ran) — the notification heartbeat. The UI
  // warns when it's stale, since a lapsed external scheduler otherwise fails silently.
  lastCronAtMs: number | null;
  taskGroups: TaskGroupVM[];
  tasksRemainingToday: number;
  projectCards: ProjectCardVM[];
  activeProjectCount: number;
  routineList: RoutineItemVM[]; // chronological by next occurrence
  routineTotalCount: number;
  habits: HabitCardVM[];
  habitAtRiskCount: number;
  calendarErrors: string[];
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  pendingCaptures: VoiceCaptureVM[];
};

export type AreaKey = "tasks" | "projects" | "routines" | "habits" | "calendar" | "day";

// Global visibility filter (top-right toggle): which calendar(s)/tasks are shown. "work"/
// "home" match against Task.category (case-insensitively) and the ICS event's `source`
// label ("Outlook" is the YCIS work calendar, "Gmail" is the home one) — see deriveEntities/
// deriveCalendarView in lib/derive.ts.
export type Mode = "work" | "home" | "all";

export type ItemKind = "task" | "project" | "routine" | "habit";

// Tasks are edited inline on their row (see TasksView) rather than through this modal.
export type ModalState =
  | { mode: "add"; initialKind?: ItemKind }
  | { mode: "edit"; kind: "project"; item: ProjectCardVM }
  | { mode: "edit"; kind: "routine"; item: RoutineItemVM }
  | { mode: "edit"; kind: "habit"; item: HabitCardVM }
  | null;
