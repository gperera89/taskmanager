"use client";

import { useMemo, useState } from "react";
import { pad2 } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import type { TaskItemVM } from "./types";

// GTD-style weekly review: a guided pass over the lists that silently rot — overdue tasks,
// dateless tasks, the coming week, and at-risk habits. Pure composition of the store's derived
// data and existing actions; no schema or server involvement.

const STEPS = ["Overdue", "No date", "Coming week", "Habits"] as const;

function ymdFrom(nowMs: number, addDays: number): string {
  const d = new Date(nowMs);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}

export default function ReviewModal({ onClose }: { onClose: () => void }) {
  const { data, actions, nowMs } = useTaskbook();
  const [step, setStep] = useState(0);

  const overdue = useMemo(() => data.taskGroups.find((g) => g.key === "overdue")?.tasks.filter((t) => !t.isCompleted) ?? [], [data.taskGroups]);
  const dateless = useMemo(() => data.taskGroups.find((g) => g.key === "none")?.tasks.filter((t) => !t.isCompleted) ?? [], [data.taskGroups]);
  const upcoming = useMemo(
    () =>
      data.taskGroups
        .filter((g) => g.key === "today" || g.key === "tomorrow" || g.key === "week")
        .flatMap((g) => g.tasks)
        .filter((t) => !t.isCompleted),
    [data.taskGroups]
  );
  const habitsAtRisk = useMemo(() => data.habitSuggested.filter((h) => h.atRisk || h.lapsed), [data.habitSuggested]);

  function TaskTriageRow({ task, showDue }: { task: TaskItemVM; showDue: boolean }) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-(--border-faint) py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-(--ink)">{task.title}</div>
          <div className="text-[11px] text-(--ink-soft)">
            {task.category}
            {task.projectName ? ` · ${task.projectName}` : ""}
            {showDue && task.dueLabel ? ` · ${task.dueLabel}` : ""}
          </div>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <button
            type="button"
            onClick={() => actions.toggleTask(task.id, task.isCompleted)}
            className="cursor-pointer rounded-full bg-(--accent-wash) px-2.5 py-1 text-[11.5px] text-(--accent-text)"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => actions.setTaskDue(task.id, ymdFrom(nowMs, 1), task.dueTimeValue)}
            className="cursor-pointer rounded-full bg-[rgba(85,118,148,.1)] px-2.5 py-1 text-[11.5px] text-(--info)"
          >
            Tomorrow
          </button>
          <button
            type="button"
            onClick={() => actions.setTaskDue(task.id, ymdFrom(nowMs, 7), task.dueTimeValue)}
            className="cursor-pointer rounded-full bg-[rgba(85,118,148,.1)] px-2.5 py-1 text-[11.5px] text-(--info)"
          >
            Next week
          </button>
          <button
            type="button"
            onClick={() => actions.removeTask(task.id)}
            className="cursor-pointer rounded-full px-2 py-1 text-[11.5px] text-(--ink-faint) hover:text-(--danger)"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  const stepEmpty = [
    "Nothing overdue — clean slate.",
    "Every task has a date. Tidy.",
    "Nothing scheduled for the coming week.",
    "No habits at risk. Streaks intact.",
  ][step];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-(--overlay) p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-135 flex-col rounded-2xl border border-(--border) bg-(--card) p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl text-(--ink)">Weekly review</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-(--ink-muted)">
            <svg width="18" height="18" viewBox="0 -960 960 960">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-full border border-(--border-strong) p-1">
          {STEPS.map((name, i) => {
            const count = [overdue.length, dateless.length, upcoming.length, habitsAtRisk.length][i];
            return (
              <button
                key={name}
                type="button"
                onClick={() => setStep(i)}
                className="flex-1 cursor-pointer rounded-full py-1.5 text-xs"
                style={{ background: step === i ? "var(--accent)" : "transparent", color: step === i ? "var(--on-accent)" : "var(--ink-muted)" }}
              >
                {name}
                {count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {step === 0 && (overdue.length ? overdue.map((t) => <TaskTriageRow key={t.id} task={t} showDue />) : <Empty text={stepEmpty} />)}
          {step === 1 && (dateless.length ? dateless.map((t) => <TaskTriageRow key={t.id} task={t} showDue={false} />) : <Empty text={stepEmpty} />)}
          {step === 2 &&
            (upcoming.length ? (
              upcoming.map((t) => (
                <div key={t.id} className="flex items-baseline justify-between gap-2 border-b border-(--border-faint) py-2">
                  <div className="min-w-0">
                    <span className="text-sm text-(--ink)">{t.title}</span>
                    <span className="ml-2 text-[11px] text-(--ink-soft)">
                      {t.category}
                      {t.projectName ? ` · ${t.projectName}` : ""}
                    </span>
                  </div>
                  <span className="flex-none text-[11.5px] text-(--info)">{t.dueLabel}</span>
                </div>
              ))
            ) : (
              <Empty text={stepEmpty} />
            ))}
          {step === 3 &&
            (habitsAtRisk.length ? (
              habitsAtRisk.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-2 border-b border-(--border-faint) py-2">
                  <div className="min-w-0">
                    <div className="text-sm text-(--ink)">{h.title}</div>
                    <div className="text-[11px] text-(--danger)">{h.detailLabel}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => actions.markHabitDone(h.id)}
                    className="cursor-pointer rounded-full bg-(--accent-wash) px-2.5 py-1 text-[11.5px] text-(--accent-text)"
                  >
                    Done today
                  </button>
                </div>
              ))
            ) : (
              <Empty text={stepEmpty} />
            ))}
        </div>

        <div className="mt-4 flex justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="cursor-pointer rounded-full border border-(--border-strong) px-4 py-1.5 text-xs text-(--ink-muted) disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="cursor-pointer rounded-full bg-(--accent) px-4 py-1.5 text-xs text-(--on-accent)"
            >
              Next
            </button>
          ) : (
            <button type="button" onClick={onClose} className="cursor-pointer rounded-full bg-(--accent) px-4 py-1.5 text-xs text-(--on-accent)">
              Finish review
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-sm italic text-(--ink-soft)">{text}</p>;
}
