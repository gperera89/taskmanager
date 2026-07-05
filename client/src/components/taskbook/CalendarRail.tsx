"use client";

import type { MonthCell } from "@/lib/taskbookDates";
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
  onDismissEvent,
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
  onDismissEvent: (eventId: string) => void;
  // "rail" is the always-on desktop side panel; "panel" is the in-content view shown
  // when Calendar is picked as a carousel tab on portrait/mobile screens.
  variant?: "rail" | "panel";
}) {
  let railTitle: string;
  let railItems: { key: string; a: string; b: string; c: string; hasC: boolean; eventId?: string; allDay?: boolean }[];

  if (selectedDay != null && dayDetail) {
    railTitle = `${dayDetail.weekday.slice(0, 3)} ${selectedDay} ${monthLabel}`;
    railItems = [
      ...dayDetail.tasks.map((t) => ({ key: `t-${t.id}`, a: "·", b: t.title, c: t.projectName ?? "", hasC: !!t.projectName })),
      ...dayDetail.projects.map((p) => ({ key: `p-${p.id}`, a: "·", b: p.name, c: "Project", hasC: true })),
      ...dayDetail.events.map((e) => ({ key: `e-${e.id}`, a: "", b: e.title, c: e.metaLabel, hasC: true, eventId: e.id, allDay: e.allDay })),
    ];
  } else {
    railTitle = "Coming up";
    railItems = upcoming;
  }

  const outerClass =
    variant === "panel"
      ? // In-content on mobile; the surrounding content wrapper supplies padding/scroll.
        "w-full lg:hidden"
      : // Desktop-only side rail — hidden below the lg breakpoint so it never overlaps content.
        "hidden w-93 flex-none overflow-y-auto border-l border-[#ddd4c1] bg-[#ece5d6] px-6.5 pb-7.5 pt-6.5 lg:block";

  return (
    <div className={outerClass}>
      <div className="mb-3 flex items-center justify-between">
        <div className="font-script text-4xl leading-[0.8] text-[#2a2622]">{monthLabel}</div>
        <div className="flex items-center gap-3.5">
          <span className="text-[13px] text-[#8a8069]">{year}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onPrevMonth} aria-label="Previous month" className="cursor-pointer p-0.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 5l-7 7 7 7" stroke="#8a8069" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" onClick={onNextMonth} aria-label="Next month" className="cursor-pointer p-0.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M9 5l7 7-7 7" stroke="#8a8069" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-[3px]">
        {WEEKDAY_HEADERS.map((w, i) => (
          <div key={i} className="text-center text-[10px] uppercase tracking-[0.16em] text-[#a49a82]">
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
                color: cell.inMonth ? (cell.isToday ? "#fff" : "#4a4436") : "#c3b9a1",
                background: cell.isToday ? "#17399b" : "transparent",
                cursor: handleClick ? "pointer" : "default",
                outline: isSelected ? "1.5px solid #17399b" : "none",
                outlineOffset: isSelected && cell.isToday ? "1px" : undefined,
              }}
            >
              <span>{cell.day}</span>
              {cell.hasDot && (
                <span
                  className="absolute bottom-[5px] h-1 w-1 rounded-full"
                  style={{ background: cell.isToday ? "#fff" : "#557694" }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="my-5.5 h-px bg-[#d5cbb4]" />
      <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-[#a49a82]">{railTitle}</div>
      <div className="flex flex-col gap-3.5">
        {railItems.map((item) => (
          <div key={item.key} className="flex items-baseline gap-2.5">
            <span className="w-17 flex-none whitespace-nowrap text-[13px] font-semibold text-[#557694]">{item.a}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm text-[#2a2622]">{item.b}</div>
              {item.hasC && <div className="mt-px text-[11.5px] text-[#a49a82]">{item.c}</div>}
            </div>
            {item.allDay && item.eventId && (
              <button
                type="button"
                onClick={() => onDismissEvent(item.eventId!)}
                aria-label={`Dismiss ${item.b}`}
                className="flex-none cursor-pointer px-1 text-[13px] text-[#b3a988] hover:text-[#8a4040]"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {railItems.length === 0 && <div className="text-[13px] italic text-[#a49a82]">Nothing scheduled.</div>}
      </div>
      {selectedDay != null && !dayOpen && (
        <div className="mt-4 text-xs italic text-[#557694]">Click {selectedDay} {monthLabel} again to open the full day →</div>
      )}
    </div>
  );
}
