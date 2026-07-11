"use client";

import type { MonthCell } from "@/lib/taskbookDates";
import { CalendarEventMarker, CalendarTaskItem } from "./shared";
import type { DayDetailVM, UpcomingItemVM } from "./types";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

export default function CalendarRail({
  monthLabel,
  year,
  cells,
  selectedDay,
  dayOpen,
  dayDetail,
  upcoming,
  onClickDay,
  onClickAdjacentDay,
  onPrevMonth,
  onNextMonth,
  onToggleTask,
  onDismissEvent,
  onRestoreEvent,
  variant = "rail",
}: {
  monthLabel: string;
  year: number;
  cells: MonthCell[];
  selectedDay: number | null;
  dayOpen: boolean;
  dayDetail: DayDetailVM | undefined;
  upcoming: UpcomingItemVM[];
  onClickDay: (day: number) => void;
  onClickAdjacentDay: (direction: "prev" | "next", day: number) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToggleTask: (id: string, isCompleted: boolean) => void;
  onDismissEvent: (eventId: string) => void;
  onRestoreEvent: (eventId: string) => void;
  // "rail" is the always-on desktop side panel; "panel" is the in-content view shown
  // when Calendar is picked as a carousel tab on portrait/mobile screens.
  variant?: "rail" | "panel";
}) {
  const railTitle = selectedDay != null && dayDetail ? `${dayDetail.weekday} ${selectedDay} ${monthLabel}` : "Coming up";

  const outerClass =
    variant === "panel"
      ? // In-content on mobile; the surrounding content wrapper supplies padding/scroll.
        "w-full lg:hidden"
      : // Desktop-only side rail — hidden below the lg breakpoint so it never overlaps content.
        "hidden w-93 flex-none overflow-y-auto border-l border-(--border) bg-(--surface-rail) px-6.5 pb-7.5 pt-6.5 lg:block";

  return (
    <div className={outerClass}>
      <div className="mb-3 flex items-center justify-between">
        <div className="font-script text-4xl leading-[0.8] text-(--ink)">{monthLabel}</div>
        <div className="flex items-center gap-3.5">
          <span className="text-[13px] text-(--ink-muted)">{year}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onPrevMonth} aria-label="Previous month" className="cursor-pointer p-0.5">
              <svg width="14" height="14" viewBox="0 -960 960 960">
                <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z" style={{ fill: "var(--ink-muted)" }} />
              </svg>
            </button>
            <button type="button" onClick={onNextMonth} aria-label="Next month" className="cursor-pointer p-0.5">
              <svg width="14" height="14" viewBox="0 -960 960 960">
                <path d="m321-80-71-71 329-329-329-329 71-71 400 400L321-80Z" style={{ fill: "var(--ink-muted)" }} />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-[3px]">
        {WEEKDAY_HEADERS.map((w, i) => (
          <div key={i} className="text-center text-[10px] uppercase tracking-[0.16em] text-(--ink-soft)">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[3px]">
        {cells.map((cell) => {
          const isSelected = cell.inMonth && selectedDay === cell.day;
          // Leading/trailing cells from adjacent months are keyed "prev-<day>"/"next-<day>" —
          // clicking one jumps straight to that month with the day selected.
          const adjacentDirection = cell.key.startsWith("prev-") ? "prev" : cell.key.startsWith("next-") ? "next" : null;
          const handleClick = cell.inMonth
            ? () => onClickDay(cell.day)
            : adjacentDirection
              ? () => onClickAdjacentDay(adjacentDirection, cell.day)
              : undefined;
          return (
            <div
              key={cell.key}
              onClick={handleClick}
              className="relative flex h-[38px] flex-col items-center justify-center rounded-lg text-[13px] select-none"
              style={{
                color: cell.inMonth ? (cell.isToday ? "var(--on-accent)" : "var(--ink-strong)") : "var(--ink-disabled)",
                background: cell.isToday ? "var(--accent)" : "transparent",
                cursor: handleClick ? "pointer" : "default",
                outline: isSelected ? "1.5px solid var(--accent-text)" : "none",
                outlineOffset: isSelected && cell.isToday ? "1px" : undefined,
              }}
            >
              <span>{cell.day}</span>
              {cell.hasDot && (
                <span
                  className="absolute bottom-[5px] h-1 w-1 rounded-full"
                  style={{ background: cell.isToday ? "var(--on-accent)" : "var(--info)" }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="my-5.5 h-px bg-(--rule)" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-(--ink-soft)">{railTitle}</span>
        {selectedDay != null && dayDetail && dayDetail.dismissedEvents.length > 0 && (
          <button
            type="button"
            onClick={() => dayDetail.dismissedEvents.forEach((d) => onRestoreEvent(d.id))}
            className="flex-none cursor-pointer whitespace-nowrap text-[11px] text-(--info) underline decoration-dotted underline-offset-2"
          >
            {dayDetail.dismissedEvents.length} dismissed · Restore
          </button>
        )}
      </div>

      {selectedDay != null && dayDetail ? (
        <div className="flex flex-col gap-3">
          {dayDetail.tasks.length === 0 && dayDetail.projects.length === 0 && dayDetail.events.length === 0 && (
            <div className="text-[13px] italic text-(--ink-soft)">Nothing scheduled.</div>
          )}
          {dayDetail.tasks.map((t) => (
            <div key={`t-${t.id}`} className="flex items-start gap-2.5">
              <CalendarTaskItem
                title={t.title}
                isCompleted={t.isCompleted}
                onToggle={() => onToggleTask(t.id, t.isCompleted)}
                projectName={t.projectName}
                size={20}
              />
            </div>
          ))}
          {dayDetail.projects.map((p) => (
            <div key={`p-${p.id}`} className="flex items-start gap-2.5">
              <span className="mt-0.5 h-5 w-5 flex-none rounded border border-(--ink-faint)" />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-(--ink)">{p.name}</div>
                <div className="mt-px text-[11.5px] text-(--ink-soft)">Project</div>
              </div>
            </div>
          ))}
          {dayDetail.events.map((e) => (
            <div key={`e-${e.id}`} className="flex items-start gap-2.5">
              <CalendarEventMarker source={e.source} title={e.title} onDismiss={() => onDismissEvent(e.id)} size={20} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-(--ink)">{e.title}</div>
                <div className="mt-px text-[11.5px] text-(--ink-soft)">{e.metaLabel}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {upcoming.map((item) => (
            <div key={item.key} className="flex items-baseline gap-2.5">
              <span className="w-17 flex-none whitespace-nowrap text-[13px] font-semibold text-(--info)">{item.a}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-(--ink)">{item.b}</div>
                {item.hasC && <div className="mt-px text-[11.5px] text-(--ink-soft)">{item.c}</div>}
              </div>
            </div>
          ))}
          {upcoming.length === 0 && <div className="text-[13px] italic text-(--ink-soft)">Nothing scheduled.</div>}
        </div>
      )}

      {selectedDay != null && !dayOpen && (
        <div className="mt-4 text-xs italic text-(--info)">Click {selectedDay} {monthLabel} again to open the full day →</div>
      )}
    </div>
  );
}
