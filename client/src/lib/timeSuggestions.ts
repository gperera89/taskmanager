// Suggested times for the Tasks view: every open task that's overdue, or due today without a
// clock time or a duration, gets a proposed slot today — or, once today has no room left (e.g.
// in the evening, after the work zone has closed), the first free slot tomorrow. Pure and client-safe, recomputed on every
// store tick like the rest of derive — so a task added mid-morning gets a slot straight away and
// the proposals slide forward as the day goes on. Nothing is stored until the user accepts one.
//
// The slots come from the My Day auto-scheduler itself rather than a second slot-finder: the
// candidates are re-dated to "today, no time" in a copy of the raw state, deriveMyDay packs them
// around the calendar, routines, pinned blocks and the day template's zones exactly as My Day
// would, and the times it lands on are read back off its timeline.

import type { CalendarEvent, Mode } from "@/components/taskbook/types";
import { deriveMyDay, formatClock, type RawState, type RawTask } from "@/lib/derive";
import { formatDuration, MS_PER_DAY } from "@/lib/shared";
import { pad2, zonedYMD } from "@/lib/taskbookDates";

// Used when the morning AI run hasn't estimated a task (e.g. it was added later in the day).
const FALLBACK_DURATION_MINUTES = 30;

export type TimeSuggestion = {
  dueDate: string; // "YYYY-MM-DD" — today, or tomorrow when today is full
  dueTime: string; // "HH:MM"
  durationMinutes: number;
  label: string; // e.g. "2:30 PM · 45 min", "Tomorrow 8 AM · 30 min", or "45 min" (duration only)
};

export function deriveTimeSuggestions(
  raw: RawState,
  calendarEvents: CalendarEvent[],
  nowMs: number,
  mode: Mode
): Map<string, TimeSuggestion> {
  const out = new Map<string, TimeSuggestion>();
  const today = zonedYMD(new Date(nowMs), raw.timeZone);
  const todayKey = `${today.year}-${pad2(today.month0 + 1)}-${pad2(today.day)}`;
  const todayMidnight = Date.UTC(today.year, today.month0, today.day);

  // A task already placed on today's plan by hand has a time, whatever its due date says.
  const plannedToday = new Set(
    raw.dayPlanBlocks
      .filter((b) => b.entityType === "TASK" && new Date(b.date).getTime() === todayMidnight)
      .map((b) => b.entityId)
  );

  // id → what kind of proposal it gets. "slot": needs a time (and maybe a duration) — re-dated
  // to float today. "duration": due today at a set time, only the duration is missing.
  const candidates = new Map<string, { kind: "slot" | "duration"; duration: number; dueMinutes: number }>();
  const tasks: RawTask[] = raw.tasks.map((t) => {
    if (t.isCompleted || !t.dueDate || plannedToday.has(t.id)) return t;
    if (t.pausedUntil && new Date(t.pausedUntil).getTime() > todayMidnight) return t;
    const due = new Date(t.dueDate);
    const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    const dueMinutes = due.getUTCHours() * 60 + due.getUTCMinutes(); // face-value clock time
    const duration = t.durationMinutes ?? t.aiDurationMinutes ?? FALLBACK_DURATION_MINUTES;

    if (dueDay === todayMidnight && dueMinutes > 0) {
      if (t.durationMinutes != null) return t; // fully scheduled already
      candidates.set(t.id, { kind: "duration", duration, dueMinutes });
      return { ...t, durationMinutes: duration };
    }
    if (dueDay > todayMidnight) return t;
    // Overdue (timed or not), or due today untimed — float it today so the scheduler places it.
    candidates.set(t.id, { kind: "slot", duration, dueMinutes: 0 });
    return { ...t, dueDate: new Date(todayMidnight), durationMinutes: duration };
  });
  if (candidates.size === 0) return out;

  // Where the scheduler floated each task (unpinned task blocks) on a given day's timeline.
  const floatedStarts = (dayTasks: RawTask[], ymd: { year: number; month0: number; day: number }) => {
    const myDay = deriveMyDay({ ...raw, tasks: dayTasks }, calendarEvents, nowMs, ymd.year, ymd.month0, ymd.day, mode);
    const starts = new Map<string, number>();
    for (const b of myDay.timeline) {
      if (b.kind === "task" && !b.pinned && !b.planBlockId) starts.set(b.entityId, b.startMinutes);
    }
    return starts;
  };
  const suggestion = (dueDate: string, start: number, duration: number, label: string): TimeSuggestion => ({
    dueDate,
    dueTime: `${pad2(Math.floor(start / 60))}:${pad2(start % 60)}`,
    durationMinutes: duration,
    label,
  });

  const todayStarts = floatedStarts(tasks, today);
  const leftover = new Set<string>();
  for (const [id, c] of candidates) {
    if (c.kind === "duration") {
      out.set(id, suggestion(todayKey, c.dueMinutes, c.duration, formatDuration(c.duration)));
      continue;
    }
    const start = todayStarts.get(id);
    if (start == null) leftover.add(id); // no room today (or blocked / outside the mode)
    else out.set(id, suggestion(todayKey, start, c.duration, `${formatClock(start)} · ${formatDuration(c.duration)}`));
  }
  if (leftover.size === 0) return out;

  // Second pass for whatever didn't fit: float those tasks on tomorrow instead. Blocked tasks and
  // ones outside the current mode stay unplaced there too, so they still get no chip.
  const tomorrowMidnight = todayMidnight + MS_PER_DAY;
  const t = new Date(tomorrowMidnight);
  const tomorrow = { year: t.getUTCFullYear(), month0: t.getUTCMonth(), day: t.getUTCDate() };
  const tomorrowKey = `${tomorrow.year}-${pad2(tomorrow.month0 + 1)}-${pad2(tomorrow.day)}`;
  const tomorrowStarts = floatedStarts(
    raw.tasks.map((task) =>
      leftover.has(task.id)
        ? { ...task, dueDate: new Date(tomorrowMidnight), durationMinutes: candidates.get(task.id)!.duration }
        : task
    ),
    tomorrow
  );
  for (const id of leftover) {
    const start = tomorrowStarts.get(id);
    if (start == null) continue;
    const duration = candidates.get(id)!.duration;
    out.set(id, suggestion(tomorrowKey, start, duration, `Tomorrow ${formatClock(start)} · ${formatDuration(duration)}`));
  }
  return out;
}
