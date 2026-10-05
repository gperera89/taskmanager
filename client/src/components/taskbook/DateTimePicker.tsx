"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
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
  dateOnly = false,
  large = false,
}: {
  dateValue: string; // yyyy-mm-dd, "" if unset
  timeValue: string; // HH:MM, "" if unset
  onChangeDate: (date: string) => void;
  onChangeTime: (time: string) => void;
  dateOnly?: boolean; // hide the time column — for pickers with no clock component (e.g. routine pause)
  large?: boolean; // phone layout: calendar stacked over a big hour-per-row time grid (see PickerPopover)
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

  if (large) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-none">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={goPrevMonth} aria-label="Previous month" className="cursor-pointer rounded-md p-2.5">
              <svg width="16" height="16" viewBox="0 -960 960 960">
                <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z" style={{ fill: "var(--ink-muted)" }} />
              </svg>
            </button>
            <span className="text-[16px] font-medium text-(--ink)">
              {MONTH_NAMES[viewedMonth0]} {viewedYear}
            </span>
            <button type="button" onClick={goNextMonth} aria-label="Next month" className="cursor-pointer rounded-md p-2.5">
              <svg width="16" height="16" viewBox="0 -960 960 960">
                <path d="m321-80-71-71 329-329-329-329 71-71 400 400L321-80Z" style={{ fill: "var(--ink-muted)" }} />
              </svg>
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7">
            {WEEKDAY_HEADERS.map((w, i) => (
              <div key={i} className="text-center text-[11px] uppercase tracking-widest text-(--ink-soft)">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
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
                  className="flex h-10 items-center justify-center rounded-lg text-[16px] select-none"
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
        {!dateOnly && (
          <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-(--border-soft) pt-3">
            <button
              type="button"
              onClick={() => onChangeTime("")}
              className="mb-2 flex-none rounded-lg px-3 py-2 text-left text-[14px] italic"
              style={{
                color: !timeValue ? "var(--accent-text)" : "var(--ink-soft)",
                background: !timeValue ? "var(--accent-wash)" : "transparent",
              }}
            >
              No time
            </button>
            {/* One row per hour. The list scrolls on its own (overscroll-contain) — and the popover
                locks the page behind it — so flicking through times never drags the screen. */}
            <div
              ref={timeListRef}
              className="relative grid min-h-35 max-h-65 flex-1 grid-cols-4 content-start gap-1 overflow-y-auto overscroll-contain"
            >
              {TIME_SLOTS.map((t) => {
                const isActive = t === activeTime;
                const isSet = isActive && !!timeValue;
                return (
                  <button
                    type="button"
                    key={t}
                    ref={isActive ? activeTimeRef : undefined}
                    onClick={() => onChangeTime(t)}
                    className="flex h-11 items-center justify-center rounded-lg text-[14px] whitespace-nowrap"
                    style={{
                      background: isSet ? "var(--accent)" : isActive ? "var(--accent-wash)" : "transparent",
                      color: isSet ? "var(--on-accent)" : t.endsWith(":00") ? "var(--ink-strong)" : "var(--ink-muted)",
                    }}
                  >
                    {formatTimeLabel(t)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    // The columns shrink rather than overflow (`min-w-0` + `flex-1` capped at the desktop width):
    // on a phone the panel is dropped inside an already-indented row, so a fixed 208+88px pair
    // pushed past the viewport edge and forced sideways scrolling.
    <div className="flex justify-center gap-2 sm:gap-3">
      <div className="w-52 max-w-52 min-w-0 flex-1">
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
      {!dateOnly && (
      <div className="w-19 flex-none border-l border-(--border-soft) pl-2">
        <button
          type="button"
          onClick={() => onChangeTime("")}
          className="mb-1 flex w-full flex-none items-center rounded px-1 py-1 text-left text-[11px] italic"
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
                className="flex flex-none items-center justify-between gap-0.5 rounded px-1 py-1 text-left text-[11.5px] whitespace-nowrap"
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
      )}
    </div>
  );
}

function useIsPhoneLayout(): boolean {
  // Matches TaskbookApp's own mobile split (below the 1024px lg breakpoint). Pickers only mount
  // after a tap, so reading matchMedia in the initializer never runs during SSR.
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsPhone(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isPhone;
}

/** Container for a DateTimePickerPanel. On desktop it's the familiar inline bordered panel (with
    `inlineClassName`). On a phone it opens as a centred popup over a dimmed backdrop, with the
    large panel layout and a Done button, and locks the page scroll behind it.

    `panelRef` lands on the element callers' click-away listeners treat as "inside" — on a phone
    that's the whole overlay, backdrop included, so a backdrop tap is handled here (`onDone`) rather
    than by the caller's outside-click logic (which, e.g. in the project add-task row, would also
    submit the half-typed task). `onDone` should do whatever a click-away does at that call site. */
export function PickerPopover({
  panelRef,
  onDone,
  title,
  inlineClassName,
  render,
  children,
}: {
  panelRef?: RefObject<HTMLDivElement | null>;
  onDone: () => void;
  title?: string;
  inlineClassName: string;
  render: (large: boolean) => ReactNode; // the DateTimePickerPanel, given the layout to use
  children?: ReactNode; // extras under the panel (Clear, reminder select…)
}) {
  const isPhone = useIsPhoneLayout();

  useEffect(() => {
    if (!isPhone) return;
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, [isPhone]);

  if (!isPhone) {
    return (
      <div ref={panelRef} className={inlineClassName}>
        {render(false)}
        {children}
      </div>
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      data-picker-popover
      className="fixed inset-0 z-50 flex items-center justify-center bg-(--overlay) p-4"
      style={{ touchAction: "none" }}
      // React events bubble through portals to the caller's tree — keep a backdrop tap from also
      // reaching e.g. ItemModal's own click-to-close overlay.
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onDone();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-full w-full max-w-100 flex-col rounded-2xl border border-(--border-strong) bg-(--card) p-4 shadow-[0_16px_48px_rgba(40,30,15,.28)]"
      >
        <div className="mb-2 flex flex-none items-center justify-between gap-3">
          <span className="text-[12px] uppercase tracking-[0.14em] text-(--ink-muted)">{title ?? "Due"}</span>
          <button
            type="button"
            onClick={onDone}
            className="cursor-pointer rounded-lg bg-(--accent) px-4 py-2 text-[14px] font-medium text-(--on-accent)"
          >
            Done
          </button>
        </div>
        {render(true)}
        {children && <div className="flex-none text-[14px]">{children}</div>}
      </div>
    </div>,
    document.body,
  );
}
