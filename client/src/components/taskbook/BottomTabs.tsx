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
    { key: "tasks", name: "Tasks", count: `${tasksRemainingToday} today`, borderClass: "border-r border-[#ddd4c1]" },
    { key: "projects", name: "Projects", count: `${activeProjectCount} active`, borderClass: "border-r border-[#ddd4c1]" },
    { key: "routines", name: "Routines", count: `${routineTotalCount}`, borderClass: "border-r border-[#ddd4c1]" },
    { key: "habits", name: "Habits", count: habitAtRiskCount > 0 ? `${habitAtRiskCount} at risk` : "on track", borderClass: "border-r border-[#ddd4c1] lg:border-r-0" },
    { key: "calendar", name: "Calendar", count: monthLabel, borderClass: "lg:hidden" },
  ];

  return (
    <div className="flex h-[70px] flex-none border-t border-[#ddd4c1] bg-[#e6ded0]">
      {tabs.map((tab) => {
        const on = area === tab.key || (area === "day" && tab.key === "calendar");
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelect(tab.key)}
            className={`flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 ${tab.borderClass}`}
            style={{
              background: on ? "#e9e1d0" : "transparent",
            }}
          >
            <span className="text-[15px]" style={{ color: on ? "#17399b" : "#8a8069", fontWeight: on ? 600 : 400 }}>
              {tab.name}
            </span>
            <span className="text-[11px]" style={{ color: on ? "#557694" : "#b3a988" }}>
              {tab.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
