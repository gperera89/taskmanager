"use client";

import { useMemo, useState } from "react";
import { parseQuickAdd } from "@/lib/quickAdd";
import { useTaskbook } from "./store";

// Natural-language quick add at the top of the Tasks view: "pay rent tomorrow 5pm every month
// #home @House" → parsed live (preview line underneath), Enter creates the task through the
// optimistic store. Plain typing with no recognized tokens still works — it's just a title.
export default function QuickAdd() {
  const { data, actions, nowMs } = useTaskbook();
  const [text, setText] = useState("");

  const parsed = useMemo(
    () =>
      text.trim()
        ? parseQuickAdd(text, { now: new Date(nowMs), categories: data.categoryOptions, projects: data.projectOptions })
        : null,
    [text, nowMs, data.categoryOptions, data.projectOptions]
  );

  function submit() {
    if (!parsed || !parsed.title) return;
    actions.addTask({
      title: parsed.title,
      category: parsed.category ?? data.categoryOptions[0]?.name ?? "Home",
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      projectId: parsed.projectId,
      repeat: parsed.repeat ? { ...parsed.repeat, monthlyMode: "DATE" as const } : null,
    });
    setText("");
  }

  return (
    <div className="mb-1 mt-4 max-w-[680px]">
      <input
        id="quick-add-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            setText("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Quick add — try “call the vet tomorrow 3pm #home”"
        aria-label="Quick add task"
        className="w-full rounded-full border border-(--border-strong) bg-(--card) px-4 py-2 text-[14px] text-(--ink) outline-none placeholder:text-(--ink-faint) focus:border-(--accent-text)"
      />
      {parsed && parsed.summary.length > 0 && (
        <div className="mt-1 px-4 text-[11.5px] text-(--info)">
          {parsed.title || "…"} <span className="text-(--ink-soft)">·</span> {parsed.summary.join(" · ")}
        </div>
      )}
    </div>
  );
}
