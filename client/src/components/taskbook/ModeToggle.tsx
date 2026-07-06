"use client";

import type { Mode } from "./types";

// Material Symbols "home" / "home_work" / "work" glyphs, inlined so the fill color
// can react to selection rather than being baked into a static asset. Exported so the calendar
// view can mark Gmail (personal/home) vs Outlook (work) events with the same glyphs.
export const ICON_PATH: Record<Mode, string> = {
  personal: "M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z",
  all: "M680-600h80v-80h-80v80Zm0 160h80v-80h-80v80Zm0 160h80v-80h-80v80Zm0 160v-80h160v-560H480v56l-80-58v-78h520v720H680Zm-640 0v-400l280-200 280 200v400H360v-200h-80v200H40Zm80-80h80v-200h240v200h80v-280L320-622 120-480v280Zm560-360ZM440-200v-200H200v200-200h240v200Z",
  work: "M160-120q-33 0-56.5-23.5T80-200v-440q0-33 23.5-56.5T160-720h160v-80q0-33 23.5-56.5T400-880h160q33 0 56.5 23.5T640-800v80h160q33 0 56.5 23.5T880-640v440q0 33-23.5 56.5T800-120H160Zm0-80h640v-440H160v440Zm240-520h160v-80H400v80ZM160-200v-440 440Z",
};

const MODE_ORDER: { key: Mode; title: string }[] = [
  { key: "personal", title: "Personal" },
  { key: "all", title: "All" },
  { key: "work", title: "Work" },
];

export default function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-[#d3c9b3] p-1">
      {MODE_ORDER.map(({ key, title }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={active}
            onClick={() => onChange(key)}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-colors"
            style={{ background: active ? "rgba(23,57,155,.12)" : "transparent" }}
          >
            <svg width="16" height="16" viewBox="0 -960 960 960">
              <path d={ICON_PATH[key]} fill={active ? "#17399b" : "#a49a82"} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
