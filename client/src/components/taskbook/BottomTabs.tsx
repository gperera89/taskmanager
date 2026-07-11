"use client";

import type { AreaKey } from "./types";

export default function BottomTabs({
  area,
  onSelect,
  tasksRemainingToday,
  activeProjectCount,
  routineTotalCount,
  habitAtRiskCount,
  monthLabel,
}: {
  area: AreaKey;
  onSelect: (area: AreaKey) => void;
  tasksRemainingToday: number;
  activeProjectCount: number;
  routineTotalCount: number;
  habitAtRiskCount: number;
  monthLabel: string;
}) {
  // The Calendar tab only appears on portrait/mobile — on desktop the calendar is an
  // always-visible side rail, so its divider (on Habits) is dropped at the lg breakpoint.
  const tabs: { key: AreaKey; name: string; count: string; borderClass: string }[] = [
    { key: "tasks", name: "Tasks", count: `${tasksRemainingToday} today`, borderClass: "border-r border-(--border)" },
    { key: "projects", name: "Projects", count: `${activeProjectCount} active`, borderClass: "border-r border-(--border)" },
    { key: "routines", name: "Routines", count: `${routineTotalCount}`, borderClass: "border-r border-(--border)" },
    { key: "habits", name: "Habits", count: habitAtRiskCount > 0 ? `${habitAtRiskCount} at risk` : "on track", borderClass: "border-r border-(--border) lg:border-r-0" },
    { key: "calendar", name: "Calendar", count: monthLabel, borderClass: "lg:hidden" },
  ];

  // Safe-area padding keeps the tabs above the iOS home indicator in the installed PWA.
  return (
    <div className="flex h-[calc(70px+env(safe-area-inset-bottom))] flex-none border-t border-(--border) bg-(--surface-raised) pb-[env(safe-area-inset-bottom)]">
      {tabs.map((tab) => {
        const on = area === tab.key || (area === "day" && tab.key === "calendar");
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelect(tab.key)}
            className={`flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 ${tab.borderClass}`}
            style={{
              background: on ? "var(--surface-active)" : "transparent",
            }}
          >
            <span className="text-[15px]" style={{ color: on ? "var(--accent-text)" : "var(--ink-muted)", fontWeight: on ? 600 : 400 }}>
              {tab.name}
            </span>
            <span className="text-[11px]" style={{ color: on ? "var(--info)" : "var(--ink-faint)" }}>
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
