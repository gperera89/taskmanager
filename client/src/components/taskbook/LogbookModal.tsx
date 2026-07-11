"use client";

import { useEffect, useState } from "react";

type LogItem = {
  id: string;
  entityType: "TASK" | "PROJECT" | "ROUTINE" | "HABIT";
  entityId: string;
  title: string;
  completedAt: string;
  auto: boolean;
};

type LogResponse = { weekCount: number; items: LogItem[] };

const KIND_LABEL: Record<LogItem["entityType"], string> = {
  TASK: "Task",
  PROJECT: "Project",
  ROUTINE: "Routine",
  HABIT: "Habit",
};

const KIND_FILTERS: { value: LogItem["entityType"] | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "TASK", label: "Tasks" },
  { value: "ROUTINE", label: "Routines" },
  { value: "HABIT", label: "Habits" },
  { value: "PROJECT", label: "Projects" },
];

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

// Completion history (Things-style Logbook), fed by the CompletionLog table via /api/logbook.
// Server-fetched on open rather than threaded through the optimistic store — history is
// read-only and doesn't need instant reactivity.
export default function LogbookModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [weekCount, setWeekCount] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [exhausted, setExhausted] = useState(false);
  const [filter, setFilter] = useState<(typeof KIND_FILTERS)[number]["value"]>("ALL");

  async function load(before?: string) {
    try {
      const res = await fetch(`/api/logbook${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: LogResponse = await res.json();
      setWeekCount(data.weekCount);
      setItems((cur) => (before ? [...cur, ...data.items] : data.items));
      if (data.items.length < 100) setExhausted(true);
      setState("ready");
    } catch (err) {
      console.error("[logbook] load failed:", err);
      setState("error");
    }
  }

  useEffect(() => {
    // Initial fetch when the modal opens; every setState in load() happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const visible = filter === "ALL" ? items : items.filter((i) => i.entityType === filter);

  // Group by calendar day (device-local — history display, not scheduling math).
  const groups: { label: string; items: LogItem[] }[] = [];
  for (const item of visible) {
    const label = DAY_FORMAT.format(new Date(item.completedAt));
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-(--overlay) p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-130 flex-col rounded-2xl border border-(--border) bg-(--card) p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xl text-(--ink)">Logbook</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-(--ink-muted)">
            <svg width="18" height="18" viewBox="0 -960 960 960">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
        </div>
        {weekCount !== null && (
          <div className="mb-3 text-[13px] text-(--info)">
            {weekCount} thing{weekCount === 1 ? "" : "s"} completed this week
          </div>
        )}

        <div className="mb-3 flex gap-1 rounded-full border border-(--border-strong) p-1">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className="flex-1 cursor-pointer rounded-full py-1 text-xs"
              style={{
                background: filter === f.value ? "var(--accent)" : "transparent",
                color: filter === f.value ? "var(--on-accent)" : "var(--ink-muted)",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {state === "loading" && <p className="py-6 text-sm italic text-(--ink-soft)">Loading…</p>}
          {state === "error" && <p className="py-6 text-sm italic text-(--danger)">Couldn&apos;t load history (offline?).</p>}
          {state === "ready" && groups.length === 0 && (
            <p className="py-6 text-sm italic text-(--ink-soft)">Nothing completed yet — history starts now.</p>
          )}
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-(--ink-soft)">{g.label}</div>
              {g.items.map((item) => (
                <div key={item.id} className="flex items-baseline justify-between gap-2 border-b border-(--border-faint) py-1.5">
                  <div className="min-w-0">
                    <span className="text-sm text-(--ink)">{item.title}</span>
                    <span className="ml-2 text-[11px] text-(--ink-soft)">
                      {KIND_LABEL[item.entityType]}
                      {item.auto ? " · auto" : ""}
                    </span>
                  </div>
                  <span className="flex-none text-[11.5px] text-(--ink-muted)">{TIME_FORMAT.format(new Date(item.completedAt))}</span>
                </div>
              ))}
            </div>
          ))}
          {state === "ready" && !exhausted && items.length > 0 && (
            <button
              type="button"
              onClick={() => void load(items[items.length - 1].completedAt)}
              className="mt-1 w-full cursor-pointer rounded-md border border-(--border-strong) py-1.5 text-xs text-(--info)"
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
