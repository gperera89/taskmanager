import type { MonthCell } from "@/lib/taskbookDates";

export type TaskItemVM = {
  id: string;
  title: string;
  isCompleted: boolean;
  category: string;
  description: string | null;
  dueDateValue: string; // yyyy-mm-dd for the edit form's <input type="date">, "" if none
  dueLabel: string | null; // e.g. "Fri 3 Jul"
  projectId: string | null;
  projectName: string | null;
  subtasksDone: number;
  subtasksTotal: number;
};

export type TaskGroupVM = {
  key: string;
  label: string;
  tasks: TaskItemVM[];
};

export type ProjectItemPreviewVM = {
  id: string;
  title: string;
  isCompleted: boolean;
  dueLabel: string | null;
};

export type ProjectCardVM = {
  id: string;
  name: string;
  description: string | null;
  dueDateValue: string;
  done: number;
  total: number;
  progressPct: number;
  preview: ProjectItemPreviewVM[];
  moreCount: number;
};

export type HabitCardVM = {
  id: string;
  title: string;
  frequency: "DAILY" | "WEEKLY" | "FORTNIGHTLY" | "MONTHLY" | "CUSTOM";
  frequencyLabel: string;
  customIntervalDays: number | null;
  currentStreak: number;
  longestStreak: number;
  atRisk: boolean;
  isDoneThisPeriod: boolean;
  detailLabel: string;
};

export type RoutineItemVM = {
  id: string;
  title: string;
  reminderTime: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  daysOfWeek: number[];
  dayOfMonth: number | null;
  isActive: boolean;
  isTicked: boolean;
  scheduleLabel: string;
};

export type DayDetailVM = {
  day: number;
  weekday: string;
  dateLabel: string;
  tasks: { id: string; title: string; isCompleted: boolean; projectName: string | null }[];
  projects: { id: string; name: string }[];
  events: { id: string; title: string; metaLabel: string }[];
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

export type TaskbookData = {
  todayLabel: string;
  monthLabel: string;
  year: number;
  monthCells: MonthCell[];
  dayDetails: Record<number, DayDetailVM>;
  upcoming: UpcomingItemVM[];
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

export type AreaKey = "tasks" | "projects" | "routines" | "habits" | "day";

export type ModalState =
  | { mode: "add"; kind: "task" }
  | { mode: "add"; kind: "project" }
  | { mode: "add"; kind: "routine" }
  | { mode: "add"; kind: "habit" }
  | { mode: "edit"; kind: "task"; item: TaskItemVM }
  | { mode: "edit"; kind: "project"; item: ProjectCardVM }
  | { mode: "edit"; kind: "routine"; item: RoutineItemVM }
  | { mode: "edit"; kind: "habit"; item: HabitCardVM }
  | null;
