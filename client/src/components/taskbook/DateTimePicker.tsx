"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildMonthCells, pad2 } from "@/lib/taskbookDates";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) out.push(`${pad2(h)}:${pad2(m)}`);
  }
  return out;
})();

function formatTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)}${period}`;
}

// When no time has been picked yet, the list should open scrolled to a useful slot rather than
// midnight: 7:30am if it's still early in the day, otherwise the next quarter-hour from now — so
// scheduling something "later today" doesn't require scrolling past a dozen already-past slots.
function defaultTimeSlot(now: Date): string {
  const sevenThirty = 7 * 60 + 30;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes <= sevenThirty) return "07:30";
  const rounded = Math.min(1425, Math.ceil(nowMinutes / 15) * 15);
  return `${pad2(Math.floor(rounded / 60))}:${pad2(rounded % 60)}`;
}

// "Jul 6, 2026" / "Jul 6, 2026 · 7:30am" — the trigger label shared by both due-date pickers.
export function formatPickerLabel(dateValue: string, timeValue: string, placeholder = "Set date"): string {
  if (!dateValue) return placeholder;
  const d = new Date(`${dateValue}T00:00:00`);
  const dateLabel = `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
  if (!timeValue) return dateLabel;
  return `${dateLabel} · ${formatTimeLabel(timeValue)}`;
}

/** Calendar + 15-minute time list, styled to match the rest of the app. Renders inline (not a
    floating popover) so callers can drop it straight into an existing expand-in-place panel —
    see TaskRow's due-date editor and ItemModal's add-task form. Clicking a greyed-out day from
    the previous/next month switches the viewed month, same as the calendar rail. */
export function DateTimePickerPanel({
  dateValue,
  timeValue,
  onChangeDate,
  onChangeTime,
}: {
  dateValue: string; // yyyy-mm-dd, "" if unset
  timeValue: string; // HH:MM, "" if unset
  onChangeDate: (date: string) => void;
  onChangeTime: (time: string) => void;
}) {
  const initial = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
  const [viewedYear, setViewedYear] = useState(initial.getFullYear());
  const [viewedMonth0, setViewedMonth0] = useState(initial.getMonth());

  const cells = useMemo(() => {
    const today = new Date();
    const todayYMD = { year: today.getFullYear(), month0: today.getMonth(), day: today.getDate() };
    return buildMonthCells(viewedYear, viewedMonth0, todayYMD, new Set());
  }, [viewedYear, viewedMonth0]);

  const selectedYMD = useMemo(() => {
    if (!dateValue) return null;
    const d = new Date(`${dateValue}T00:00:00`);
    return { year: d.getFullYear(), month0: d.getMonth(), day: d.getDate() };
  }, [dateValue]);

  function goPrevMonth() {
    setViewedYear(viewedMonth0 === 0 ? viewedYear - 1 : viewedYear);
    setViewedMonth0(viewedMonth0 === 0 ? 11 : viewedMonth0 - 1);
  }
  function goNextMonth() {
    setViewedYear(viewedMonth0 === 11 ? viewedYear + 1 : viewedYear);
    setViewedMonth0(viewedMonth0 === 11 ? 0 : viewedMonth0 + 1);
  }

  function selectDay(year: number, month0: number, day: number) {
    onChangeDate(`${year}-${pad2(month0 + 1)}-${pad2(day)}`);
  }

  function clickAdjacentDay(direction: "prev" | "next", day: number) {
    const newMonth0 = direction === "prev" ? (viewedMonth0 === 0 ? 11 : viewedMonth0 - 1) : viewedMonth0 === 11 ? 0 : viewedMonth0 + 1;
    const newYear = direction === "prev" ? (viewedMonth0 === 0 ? viewedYear - 1 : viewedYear) : viewedMonth0 === 11 ? viewedYear + 1 : viewedYear;
    setViewedYear(newYear);
    setViewedMonth0(newMonth0);
    selectDay(newYear, newMonth0, day);
  }

  const timeListRef = useRef<HTMLDivElement>(null);
  const activeTimeRef = useRef<HTMLButtonElement>(null);
  const activeTime = timeValue || defaultTimeSlot(new Date());

  useEffect(() => {
    const el = activeTimeRef.current;
    const container = timeListRef.current;
    if (!el || !container) return;
    container.scrollTop = Math.max(0, el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2);
    // Only on mount — this mirrors the panel's own lifecycle (it's remounted fresh each time
    // the picker is opened), so re-running on every keystroke/selection would fight the user.
  }, []);

  return (
    <div className="flex gap-3">
      <div className="w-52 flex-none">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={goPrevMonth} aria-label="Previous month" className="cursor-pointer p-0.5">
            <svg width="12" height="12" viewBox="0 -960 960 960">
              <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
          <span className="text-[12.5px] text-(--ink)">
            {MONTH_NAMES[viewedMonth0]} {viewedYear}
          </span>
          <button type="button" onClick={goNextMonth} aria-label="Next month" className="cursor-pointer p-0.5">
            <svg width="12" height="12" viewBox="0 -960 960 960">
              <path d="m321-80-71-71 329-329-329-329 71-71 400 400L321-80Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
        </div>
        <div className="mb-1 grid grid-cols-7">
          {WEEKDAY_HEADERS.map((w, i) => (
            <div key={i} className="text-center text-[9.5px] uppercase tracking-widest text-(--ink-soft)">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((cell) => {
            const isSelected =
              !!selectedYMD &&
              cell.inMonth &&
              selectedYMD.year === viewedYear &&
              selectedYMD.month0 === viewedMonth0 &&
              selectedYMD.day === cell.day;
            const adjacentDirection = cell.key.startsWith("prev-") ? "prev" : cell.key.startsWith("next-") ? "next" : null;
            const handleClick = cell.inMonth
              ? () => selectDay(viewedYear, viewedMonth0, cell.day)
              : adjacentDirection
                ? () => clickAdjacentDay(adjacentDirection, cell.day)
                : undefined;
            return (
              <button
                type="button"
                key={cell.key}
                onClick={handleClick}
                disabled={!handleClick}
                className="flex h-7 items-center justify-center rounded-md text-[12px] select-none"
                style={{
                  color: isSelected ? "var(--on-accent)" : cell.inMonth ? "var(--ink)" : "var(--ink-disabled)",
                  background: isSelected ? "var(--accent)" : cell.isToday ? "var(--accent-wash)" : "transparent",
                  cursor: handleClick ? "pointer" : "default",
                }}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
      <div className="w-22 flex-none border-l border-(--border-soft) pl-2.5">
        <button
          type="button"
          onClick={() => onChangeTime("")}
          className="mb-1 flex w-full flex-none items-center rounded px-1.5 py-1 text-left text-[11px] italic"
          style={{
            color: !timeValue ? "var(--accent-text)" : "var(--ink-soft)",
            background: !timeValue ? "var(--accent-wash)" : "transparent",
          }}
        >
          No time
        </button>
        <div ref={timeListRef} className="flex h-47.5 flex-col overflow-y-auto">
          {TIME_SLOTS.map((t) => {
            const isActive = t === activeTime;
            const isSet = isActive && !!timeValue;
            return (
              <button
                type="button"
                key={t}
                ref={isActive ? activeTimeRef : undefined}
                onClick={() => onChangeTime(t)}
                className="flex flex-none items-center justify-between gap-1 rounded px-1.5 py-1 text-left text-[12px] whitespace-nowrap"
                style={{ background: isSet ? "var(--accent-wash)" : "transparent", color: isSet ? "var(--accent)" : "var(--ink-strong)" }}
              >
                {formatTimeLabel(t)}
                {isSet && (
                  <svg width="10" height="10" viewBox="0 -960 960 960">
                    <path d="M378-208 122-464l67-67 189 189 383-383 67 67-450 450Z" style={{ fill: "var(--accent-text)" }} />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
