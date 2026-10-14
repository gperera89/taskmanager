"use client";

// The AI planner's ideas, shown above the task list. The morning run prepares up to five a day;
// three show at a time, and adding or dismissing one pulls the next into view. ↻ tops the set
// back up to five (it never replaces ideas still on screen).

import { useState } from "react";
import { refreshSuggestions } from "@/app/actions";
import { calendarDateFromDue, formatShortDate, pad2, zonedYMD } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import { labelClass } from "./shared";
import type { CategoryOption } from "./types";

const VISIBLE_SUGGESTIONS = 3;

function defaultCategory(options: CategoryOption[]): string {
  return (options.find((c) => c.scope === "WORK") ?? options[0])?.name ?? "Work";
}

export default function SuggestionStrip() {
  const { raw, data, actions, nowMs, syncNow } = useTaskbook();
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshSuggestions();
      syncNow(); // pull the new rows into the store
    } catch (err) {
      console.error("refreshSuggestions failed:", err);
    } finally {
      setRefreshing(false);
    }
  }

  // An idea dated before today is prep for something that already happened — hide it rather than
  // waiting for the next run to sweep it out. Undated ideas have no moment to miss, so they stay.
  const today = zonedYMD(new Date(nowMs), raw.timeZone);
  const todayKey = `${today.year}-${pad2(today.month0 + 1)}-${pad2(today.day)}`;
  const pending = raw.suggestions.filter(
    (s) => !s.suggestedDate || new Date(s.suggestedDate).toISOString().slice(0, 10) >= todayKey
  );
  if (pending.length === 0) return null;

  const category = defaultCategory(data.categoryOptions);
  const projectName = new Map(raw.projects.map((p) => [p.id, p.name]));
  const visible = pending.slice(0, VISIBLE_SUGGESTIONS);
  const queued = pending.length - visible.length;

  return (
    <div className="mt-4 max-w-[680px] rounded-xl border border-(--border-soft) px-3.5 pb-1 pt-2.5">
      <div className="flex items-center justify-between">
        <div className={labelClass}>Suggested{queued > 0 ? ` · ${queued} more` : ""}</div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="cursor-pointer text-[12.5px] text-(--info) hover:underline disabled:opacity-50"
        >
          {refreshing ? "Thinking…" : "↻"}
        </button>
      </div>
      {visible.map((s) => {
        const dateKey = s.suggestedDate ? new Date(s.suggestedDate).toISOString().slice(0, 10) : null;
        const project = s.projectId ? projectName.get(s.projectId) : undefined;
        const meta = [
          s.description,
          s.eventTitle ? `for “${s.eventTitle}”` : null,
          project ?? null,
          s.suggestedDate ? formatShortDate(calendarDateFromDue(new Date(s.suggestedDate))) : null,
        ].filter(Boolean);
        return (
          <div key={s.id} className="flex items-start gap-2.5 border-t border-(--border-soft) py-2 first:border-t-0">
            <span
              className="mt-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] uppercase tracking-wide"
              style={{ color: "var(--info)", background: "var(--info-wash)" }}
            >
              {s.kind}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] text-(--ink)">{s.title}</div>
              {meta.length > 0 && <div className="text-[11.5px] text-(--ink-soft)">{meta.join(" · ")}</div>}
            </div>
            <button
              type="button"
              onClick={() => actions.acceptSuggestion(s.id, category, dateKey)}
              className="cursor-pointer whitespace-nowrap rounded-full border border-(--border) px-3 py-0.5 text-[12.5px] text-(--accent-text) hover:bg-(--accent-wash)"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => actions.dismissSuggestion(s.id)}
              aria-label={`Dismiss ${s.title}`}
              className="cursor-pointer px-1 text-[15px] leading-6 text-(--ink-faint) hover:text-(--danger)"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
