"use client";

import type { AreaKey } from "./types";

export default function BottomTabs({
  area,
  onSelect,
  tasksRemainingToday,
  activeProjectCount,
  routineTotalCount,
  habitAtRiskCount,
}: {
  area: AreaKey;
  onSelect: (area: AreaKey) => void;
  tasksRemainingToday: number;
  activeProjectCount: number;
  routineTotalCount: number;
  habitAtRiskCount: number;
}) {
  const tabs: { key: AreaKey; name: string; count: string; last?: boolean }[] = [
    { key: "tasks", name: "Tasks", count: `${tasksRemainingToday} today` },
    { key: "projects", name: "Projects", count: `${activeProjectCount} active` },
    { key: "routines", name: "Routines", count: `${routineTotalCount}` },
    { key: "habits", name: "Habits", count: habitAtRiskCount > 0 ? `${habitAtRiskCount} at risk` : "on track", last: true },
  ];

  return (
    <div className="flex h-[70px] flex-none border-t border-[#ddd4c1] bg-[#e6ded0]">
      {tabs.map((tab) => {
        const on = area === tab.key || (area === "day" && tab.key === "tasks");
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelect(tab.key)}
            className="flex h-full flex-1 cursor-pointer flex-col items-center justify-center gap-0.5"
            style={{
              borderRight: tab.last ? "none" : "1px solid #ddd4c1",
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
