"use client";

import { useState } from "react";
import { useTaskbook } from "./store";
import { habitDateKey } from "@/lib/shared";
import type { HabitCardVM } from "./types";

// The completion heatmap (Claude-Code / GitHub contribution grid). Columns are Monday-start
// weeks, rows are days of the week. Only completed days are colored. Clicking a past/today cell
// toggles that day's completion via the optimistic store, so back-filling a missed log is a tap.

const MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]; // Mon..Sun, matching row order

const RANGES: { key: string; label: string; days: number }[] = [
  { key: "14d", label: "14 days", days: 14 },
  { key: "1m", label: "1 month", days: 30 },
  { key: "3m", label: "3 months", days: 91 },
  { key: "6m", label: "6 months", days: 182 },
  { key: "1y", label: "1 year", days: 365 },
];

type Cell = { key: string; inRange: boolean; isFuture: boolean; isToday: boolean } | null;
type Column = { cells: Cell[]; monthLabel: string | null };

function keyOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function buildColumns(todayKey: string, rangeDays: number): Column[] {
  const today = Date.parse(`${todayKey}T00:00:00.000Z`);
  const startBound = today - (rangeDays - 1) * MS;
  const startWeekday = new Date(startBound).getUTCDay();
  const firstMonday = startBound - ((startWeekday + 6) % 7) * MS;

  const columns: Column[] = [];
  let prevMonth = -1;
  for (let colMs = firstMonday; colMs <= today; colMs += 7 * MS) {
    const cells: Cell[] = [];
    for (let row = 0; row < 7; row++) {
      const ms = colMs + row * MS;
      if (ms < startBound) {
        cells.push(null); // blank spacer before the range starts
        continue;
      }
      const key = keyOf(ms);
      cells.push({ key, inRange: ms <= today, isFuture: ms > today, isToday: key === todayKey });
    }
    const month = new Date(colMs).getUTCMonth();
    const monthLabel = month !== prevMonth ? MONTHS[month] : null;
    prevMonth = month;
    columns.push({ cells, monthLabel });
  }
  return columns;
}

export default function HabitHeatmap({ habit, onClose }: { habit: HabitCardVM; onClose: () => void }) {
  const { actions, raw, nowMs } = useTaskbook();
  const [rangeKey, setRangeKey] = useState("3m");
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];

  const completed = new Set(habit.completedDates);
  const todayKey = habitDateKey(new Date(nowMs), raw.timeZone);
  const columns = buildColumns(todayKey, range.days);

  // A day is "on break" when it falls inside the habit's planned pause band (inclusive).
  const isPaused = (key: string) => Boolean(habit.pauseStart) && key >= habit.pauseStart && key <= habit.pauseEnd;

  const cellSize = 15;
  const gap = 3;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-(--overlay) p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-160 flex-col rounded-2xl border border-(--border) bg-(--card) p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-xl text-(--ink)">{habit.title}</h2>
            <div className="mt-0.5 text-[13px] text-(--ink-muted)">
              {habit.detailLabel} · {habit.streak} in a row · {habit.progressDone}/{habit.progressTarget}{" "}
              {habit.detailLabel.includes("month") ? "this month" : "this week"}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-(--ink-muted)">
            <svg width="18" height="18" viewBox="0 -960 960 960">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
        </div>

        <div className="mt-3 mb-4 flex gap-1 rounded-full border border-(--border-strong) p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRangeKey(r.key)}
              className="flex-1 cursor-pointer rounded-full py-1 text-xs"
              style={{
                background: rangeKey === r.key ? "var(--accent)" : "transparent",
                color: rangeKey === r.key ? "var(--on-accent)" : "var(--ink-muted)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex gap-2">
            {/* Weekday row labels */}
            <div className="flex flex-none flex-col pt-[18px]" style={{ gap }}>
              {WEEKDAY_LABELS.map((w, i) => (
                <div key={i} style={{ height: cellSize, width: 14 }} className="text-[9px] leading-[15px] text-(--ink-soft)">
                  {i % 2 === 0 ? w : ""}
                </div>
              ))}
            </div>
            {/* Week columns */}
            <div className="flex" style={{ gap }}>
              {columns.map((col, ci) => (
                <div key={ci} className="flex flex-col">
                  <div style={{ height: 15 }} className="text-[9px] leading-[15px] text-(--ink-soft)">
                    {col.monthLabel ?? ""}
                  </div>
                  <div className="flex flex-col" style={{ gap }}>
                    {col.cells.map((cell, ri) => (
                      <HeatCell
                        key={ri}
                        cell={cell}
                        size={cellSize}
                        completed={cell ? completed.has(cell.key) : false}
                        paused={cell ? isPaused(cell.key) : false}
                        onToggle={(key) => actions.toggleHabitCompletion(habit.id, key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <HabitBreakControl habit={habit} onSet={(start, end) => actions.setHabitPause(habit.id, start, end)} />

        <p className="mt-3 text-[11.5px] text-(--ink-soft)">Tap a day to add or remove a completion.</p>
      </div>
    </div>
  );
}

// Sets or clears a planned break (holiday) for the habit — an inclusive [start, end] band that
// greys out in the grid above and is excluded from streak / at-risk math.
function HabitBreakControl({
  habit,
  onSet,
}: {
  habit: HabitCardVM;
  onSet: (start: string, end: string) => void;
}) {
  const [start, setStart] = useState(habit.pauseStart);
  const [end, setEnd] = useState(habit.pauseEnd);
  const dateInputClass =
    "rounded-md border border-(--border-strong) bg-transparent px-1.5 py-0.5 text-xs text-(--ink) outline-none";
  const canApply = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
  return (
    <div className="mt-4 border-t border-(--border-soft) pt-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">Planned break</div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="Break start" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} className={dateInputClass} />
        <span className="text-xs text-(--ink-soft)">to</span>
        <input type="date" aria-label="Break end" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={dateInputClass} />
        <button
          type="button"
          disabled={!canApply}
          onClick={() => onSet(start, end)}
          className="cursor-pointer rounded-md bg-(--accent) px-2.5 py-1 text-xs text-(--on-accent) disabled:opacity-50"
        >
          Set break
        </button>
        {habit.pauseStart && (
          <button
            type="button"
            onClick={() => {
              setStart("");
              setEnd("");
              onSet("", "");
            }}
            className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function HeatCell({
  cell,
  size,
  completed,
  paused,
  onToggle,
}: {
  cell: Cell;
  size: number;
  completed: boolean;
  paused: boolean;
  onToggle: (key: string) => void;
}) {
  if (!cell) return <div style={{ width: size, height: size }} />;
  const clickable = cell.inRange && !cell.isFuture;
  // A completed day inside a break still shows the accent (they did it anyway); an uncompleted
  // break day is hatched-grey so a planned skip reads clearly instead of as a miss.
  const background = completed
    ? "var(--accent)"
    : paused
      ? "repeating-linear-gradient(45deg, var(--border-soft) 0 2px, transparent 2px 4px)"
      : cell.isFuture
        ? "transparent"
        : "var(--border-faint)";
  return (
    <button
      type="button"
      disabled={!clickable && !paused}
      onClick={() => clickable && onToggle(cell.key)}
      title={paused && !completed ? `${cell.key} — on break` : cell.key}
      aria-label={`${cell.key}${completed ? " — completed" : paused ? " — on break" : ""}`}
      style={{
        width: size,
        height: size,
        background,
        borderRadius: 3,
        border: cell.isToday ? "1.5px solid var(--accent-text)" : "1px solid var(--border-faint)",
        cursor: clickable ? "pointer" : "default",
        opacity: cell.isFuture && !paused ? 0.35 : 1,
      }}
    />
  );
}
