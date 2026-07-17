"use client";

import { useState } from "react";
import { formatUtcOffset, getTimeZoneOffsetMs, OTHER_TIME_ZONES, SUPPORTED_TIME_ZONES } from "@/lib/taskbookDates";
import CategoryManager from "./CategoryManager";
import { SelectField } from "./shared";
import { useTaskbook } from "./store";
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-(--overlay) p-6" onClick={onClose}>
      <div
        className="w-full max-w-105 rounded-2xl border border-(--border) bg-(--card) p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl text-(--ink)">Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-(--ink-muted)">
            <svg width="18" height="18" viewBox="0 -960 960 960">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">Categories</label>
          <CategoryManager categoryOptions={categoryOptions} />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">Timezone</label>
          <p className="mb-1 text-xs text-(--ink-muted)">
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
                    ? { background: "var(--accent)", borderColor: "var(--accent-text)", color: "var(--on-accent)" }
                    : { background: "transparent", borderColor: "var(--border-strong)", color: "var(--ink)" }
                }
              >
                {zoneLabel(z)}
              </button>
            ))}
          </div>
          <div className="mt-1.5">
            <SelectField
              value={OTHER_TIME_ZONES.some((z) => z.id === timeZone) ? timeZone : ""}
              onChange={(v) => {
                if (v) onSetTimeZone(v);
              }}
              options={OTHER_TIME_ZONES.map((z) => ({ value: z.id, label: zoneLabel(z) }))}
              placeholder="More timezones…"
              ariaLabel="More timezones"
              className="w-full rounded-md border px-2.5 py-1 text-xs"
              triggerStyle={
                OTHER_TIME_ZONES.some((z) => z.id === timeZone)
                  ? { background: "var(--accent)", borderColor: "var(--accent-text)", color: "var(--on-accent)" }
                  : { background: "transparent", borderColor: "var(--border-strong)", color: "var(--ink)" }
              }
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">Notifications</label>
          <NotificationHealth />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">AI planner notes</label>
          <p className="mb-1 text-xs text-(--ink-muted)">
            Standing instructions the AI reads when suggesting tasks from your calendar.
          </p>
          <AiNotesManager />
        </div>
      </div>
    </div>
  );
}

function AiNotesManager() {
  const { raw, actions } = useTaskbook();
  const [draft, setDraft] = useState("");

  return (
    <div className="flex max-h-52 flex-col gap-1.5 overflow-y-auto">
      {raw.aiNotes.map((n) => (
        <div key={n.id} className="group flex items-start gap-2 rounded-lg border border-(--border-faint) p-2 text-[12.5px] text-(--ink)">
          <span className="min-w-0 flex-1">{n.content}</span>
          <button
            type="button"
            onClick={() => actions.removeAiNote(n.id)}
            aria-label="Delete note"
            className="cursor-pointer text-[12px] text-(--ink-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover:opacity-100"
          >
            Delete
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) {
            actions.addAiNote(draft);
            setDraft("");
          }
        }}
        className="flex items-center gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an instruction…"
          className="flex-1 rounded-md border border-(--border-strong) bg-transparent px-2.5 py-1.5 text-[12.5px] text-(--ink) outline-none placeholder:text-(--ink-ghost)"
        />
        <button type="submit" className="cursor-pointer rounded-md bg-(--accent) px-2.5 py-1 text-xs text-(--on-accent)">
          Add
        </button>
      </form>
    </div>
  );
}

// Heartbeat status + a test-send button, so "are notifications actually working" is
// answerable from inside the app instead of by waiting for something to come due.
function NotificationHealth() {
  const { data, nowMs } = useTaskbook();
  const [testState, setTestState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  async function sendTest() {
    setTestState("sending");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { ntfyConfigured?: boolean };
      setTestState("sent");
      if (body.ntfyConfigured === false) {
        console.warn("[notifications] NTFY_TOPIC is not configured — only web push was attempted.");
      }
    } catch (err) {
      console.error("[notifications] test send failed:", err);
      setTestState("failed");
    }
  }

  const staleMin = data.lastCronAtMs === null ? null : Math.round((nowMs - data.lastCronAtMs) / 60000);
  return (
    <div className="rounded-lg border border-(--border-strong) bg-(--card) p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className={staleMin !== null && staleMin <= 10 ? "text-(--info)" : "text-(--danger)"}>
          {staleMin === null
            ? "Reminder checker has never run — set up the external cron."
            : staleMin <= 10
              ? `Reminder checker healthy (last ran ${staleMin <= 1 ? "just now" : `${staleMin} min ago`}).`
              : `Reminder checker last ran ${staleMin} min ago — the scheduler may have stopped.`}
        </span>
        <button
          type="button"
          onClick={() => void sendTest()}
          disabled={testState === "sending"}
          className="cursor-pointer whitespace-nowrap rounded-md bg-(--accent) px-2.5 py-1 text-xs text-(--on-accent) disabled:opacity-60"
        >
          {testState === "sending" ? "Sending…" : testState === "sent" ? "Sent ✓" : testState === "failed" ? "Failed — retry" : "Send test"}
        </button>
      </div>
    </div>
  );
}
