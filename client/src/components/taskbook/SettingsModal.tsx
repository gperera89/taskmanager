"use client";

import { formatUtcOffset, getTimeZoneOffsetMs, OTHER_TIME_ZONES, SUPPORTED_TIME_ZONES } from "@/lib/taskbookDates";
import CategoryManager from "./CategoryManager";
import NotificationSetup from "./NotificationSetup";
import type { CategoryOption } from "./types";

export default function SettingsModal({
  categoryOptions,
  timeZone,
  onSetTimeZone,
  onClose,
}: {
  categoryOptions: CategoryOption[];
  timeZone: string;
  onSetTimeZone: (timeZone: string) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const zoneLabel = (z: { id: string; label: string }) =>
    `${z.label} (${formatUtcOffset(getTimeZoneOffsetMs(now, z.id))})`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(42,38,34,.35)] p-6" onClick={onClose}>
      <div
        className="w-full max-w-105 rounded-2xl border border-[#ddd4c1] bg-[#faf7ef] p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl text-[#2a2622]">Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-[#8a8069]">
            <svg width="18" height="18" viewBox="0 -960 960 960">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" fill="#8a8069" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#8a8069]">Categories</label>
          <CategoryManager categoryOptions={categoryOptions} />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#8a8069]">Timezone</label>
          <p className="mb-1 text-xs text-[#8a8069]">
            Governs due-date/reminder times and how calendar events are displayed.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_TIME_ZONES.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => onSetTimeZone(z.id)}
                className="cursor-pointer rounded-md border px-2.5 py-1 text-xs"
                style={
                  z.id === timeZone
                    ? { background: "#17399b", borderColor: "#17399b", color: "#fff" }
                    : { background: "transparent", borderColor: "#d3c9b3", color: "#2a2622" }
                }
              >
                {zoneLabel(z)}
              </button>
            ))}
          </div>
          <select
            value={OTHER_TIME_ZONES.some((z) => z.id === timeZone) ? timeZone : ""}
            onChange={(e) => {
              if (e.target.value) onSetTimeZone(e.target.value);
            }}
            className="mt-1.5 cursor-pointer rounded-md border px-2.5 py-1 text-xs"
            style={
              OTHER_TIME_ZONES.some((z) => z.id === timeZone)
                ? { background: "#17399b", borderColor: "#17399b", color: "#fff" }
                : { background: "transparent", borderColor: "#d3c9b3", color: "#2a2622" }
            }
          >
            <option value="" disabled>
              More timezones…
            </option>
            {OTHER_TIME_ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {zoneLabel(z)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#8a8069]">Notifications</label>
          <NotificationSetup />
        </div>
      </div>
    </div>
  );
}
