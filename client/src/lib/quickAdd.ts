// Natural-language quick add: turns "pay rent tomorrow 5pm every month #home" into a typed
// task input. Pure and dependency-free — pragmatic patterns over full NLP:
//   dates:   today · tomorrow · mon..sunday (optionally "next …") · next week · in N days ·
//            5 jan / jan 5 (optional year)
//   times:   5pm · 5:30pm · 17:00 · at 5
//   repeat:  every day/week/month · daily/weekly/monthly · every N days/weeks/months ·
//            every mon[, wed …]
//   #category (matched case-insensitively against existing categories)
//   @project  (matched case-insensitively against existing project names, prefix ok)
// Everything unmatched is the title.

import type { RoutineFrequency } from "@prisma/client";
import { pad2 } from "@/lib/taskbookDates";

export type QuickAddRepeat = {
  frequency: RoutineFrequency;
  interval: number;
  daysOfWeek: number[];
};

export type QuickAddResult = {
  title: string;
  category: string | null;
  projectId: string | null;
  projectName: string | null;
  dueDate: string | null; // yyyy-mm-dd
  dueTime: string | null; // HH:MM
  repeat: QuickAddRepeat | null;
  // Human summary of what was recognized, for the live preview line under the input.
  summary: string[];
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function dayIndex(word: string): number {
  const w = word.toLowerCase();
  let i = DAY_NAMES.indexOf(w);
  if (i === -1) i = DAY_ABBR.indexOf(w.slice(0, 3));
  return i;
}

function monthIndex(word: string): number {
  const w = word.toLowerCase();
  return MONTH_NAMES.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3));
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

// Next occurrence of `weekday` strictly after today ("friday" on a Friday = next week's).
function nextWeekday(base: Date, weekday: number): Date {
  const diff = (weekday - base.getDay() + 7) % 7 || 7;
  return addDays(base, diff);
}

function parseTime(text: string): { time: string; match: string } | null {
  // 17:00 / 5:30pm / 5pm / at 5
  const m = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  const hasMeridiem = Boolean(m[3]);
  const hasMinutes = Boolean(m[2]);
  const prefixedWithAt = /^at\s/i.test(m[0]);
  // A bare number ("buy 3 apples") is only a time if anchored by "at", minutes, or am/pm.
  if (!hasMeridiem && !hasMinutes && !prefixedWithAt) return null;
  let hours = Number(m[1]);
  const minutes = m[2] ? Number(m[2]) : 0;
  if (hours > 23 || minutes > 59) return null;
  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";
    if (hours === 12) hours = pm ? 12 : 0;
    else if (pm) hours += 12;
  }
  return { time: `${pad2(hours)}:${pad2(minutes)}`, match: m[0] };
}

export function parseQuickAdd(
  input: string,
  options: {
    now: Date;
    categories: { id: string; name: string }[];
    projects: { id: string; name: string }[];
  }
): QuickAddResult {
  let text = ` ${input.trim()} `;
  const summary: string[] = [];
  const { now } = options;

  // --- #category ---
  let category: string | null = null;
  text = text.replace(/\s#([\w-]+)/i, (full, tag: string) => {
    const match = options.categories.find((c) => c.name.toLowerCase() === tag.toLowerCase());
    if (!match) return full;
    category = match.name;
    return " ";
  });

  // --- @project (single-word prefix match against project names) ---
  let projectId: string | null = null;
  let projectName: string | null = null;
  text = text.replace(/\s@([\w-]+)/i, (full, tag: string) => {
    const match = options.projects.find((p) => p.name.toLowerCase().startsWith(tag.toLowerCase()));
    if (!match) return full;
    projectId = match.id;
    projectName = match.name;
    return " ";
  });

  // --- repeat ---
  let repeat: QuickAddRepeat | null = null;
  // every N days/weeks/months
  text = text.replace(/\severy\s+(\d+)\s+(day|week|month)s?\b/i, (_full, n: string, unit: string) => {
    const u = unit.toLowerCase();
    const frequency: RoutineFrequency = u === "day" ? "DAILY" : u === "week" ? "WEEKLY" : "MONTHLY";
    repeat = { frequency, interval: Number(n), daysOfWeek: [] };
    return " ";
  });
  // every mon, wed / every monday
  if (!repeat) {
    text = text.replace(
      /\severy\s+((?:sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s*,\s*(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)*)\b/i,
      (_full, days: string) => {
        const list = days.split(/\s*,\s*/).map(dayIndex).filter((d) => d >= 0);
        if (!list.length) return _full;
        repeat = { frequency: "WEEKLY", interval: 1, daysOfWeek: [...new Set(list)].sort() };
        return " ";
      }
    );
  }
  // every day/week/month, daily/weekly/monthly
  if (!repeat) {
    text = text.replace(/\s(?:every\s+(day|week|month)|(daily|weekly|monthly))\b/i, (_full, unit?: string, adv?: string) => {
      const base = (unit ?? adv ?? "").toLowerCase();
      const frequency: RoutineFrequency = base.startsWith("da") ? "DAILY" : base.startsWith("we") ? "WEEKLY" : "MONTHLY";
      repeat = { frequency, interval: 1, daysOfWeek: [] };
      return " ";
    });
  }

  // --- date ---
  let dueDate: string | null = null;
  const applyDate = (d: Date) => {
    dueDate = ymd(d);
  };
  text = text.replace(/\s(today|tod)\b/i, () => (applyDate(now), " "));
  if (!dueDate) text = text.replace(/\s(tomorrow|tmr|tmrw)\b/i, () => (applyDate(addDays(now, 1)), " "));
  if (!dueDate) text = text.replace(/\snext\s+week\b/i, () => (applyDate(addDays(now, 7)), " "));
  if (!dueDate) {
    text = text.replace(/\sin\s+(\d+)\s+days?\b/i, (_full, n: string) => (applyDate(addDays(now, Number(n))), " "));
  }
  if (!dueDate) {
    text = text.replace(/\s(?:next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, (full, day: string) => {
      const idx = dayIndex(day);
      if (idx < 0) return full;
      applyDate(nextWeekday(now, idx));
      return " ";
    });
  }
  if (!dueDate) {
    // "5 jan" / "jan 5" (+ optional year)
    const dayFirst = /\s(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?\b/i;
    const monthFirst = /\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:\s+(\d{4}))?\b/i;
    const tryMatch = (re: RegExp, dayGroup: number, monthGroup: number) => {
      text = text.replace(re, (full, ...groups: string[]) => {
        const day = Number(groups[dayGroup]);
        const month = monthIndex(groups[monthGroup]);
        if (month < 0 || day < 1 || day > 31) return full;
        const year = groups[2] ? Number(groups[2]) : now.getFullYear();
        let d = new Date(year, month, day);
        if (!groups[2] && d < addDays(now, -1)) d = new Date(year + 1, month, day); // past date w/o year → next year
        applyDate(d);
        return " ";
      });
    };
    tryMatch(dayFirst, 0, 1);
    if (!dueDate) tryMatch(monthFirst, 1, 0);
  }

  // --- time (only meaningful with a date; "at 5" alone implies today) ---
  let dueTime: string | null = null;
  const timeResult = parseTime(text);
  if (timeResult) {
    dueTime = timeResult.time;
    text = text.replace(timeResult.match, " ");
    if (!dueDate) dueDate = ymd(now);
  }

  const title = text.replace(/\s+/g, " ").trim();

  if (dueDate) summary.push(dueTime ? `${dueDate} ${dueTime}` : dueDate);
  if (repeat) {
    const r = repeat as QuickAddRepeat;
    const unit = r.frequency === "DAILY" ? "day" : r.frequency === "WEEKLY" ? "week" : "month";
    let label = r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`;
    if (r.daysOfWeek.length) label = `every ${r.daysOfWeek.map((d) => DAY_ABBR[d]).join(", ")}`;
    summary.push(label);
  }
  if (category) summary.push(`#${category}`);
  if (projectName) summary.push(`@${projectName}`);

  return { title, category, projectId, projectName, dueDate, dueTime, repeat, summary };
}
