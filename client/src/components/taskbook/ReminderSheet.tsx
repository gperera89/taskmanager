"use client";

import { useMemo } from "react";
import { deriveEntities } from "@/lib/derive";
import { pad2 } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import type { TaskGroupVM } from "./types";

// What a tapped reminder opens: the task or routine it was about, with its quick actions ready.
// iPhone (and Safari generally) can't put buttons on a web-app notification, so this is where
// ntfy's "Done" / "Snooze 1 day" buttons live now — one tap to open, one to act. Reached through
// the `?open=task:<id>` / `?open=routine:<id>` link every reminder carries (lib/notifications.ts),
// or a message from the service worker when Cura was already running (public/sw.js).

export type ReminderTarget = { kind: "task" | "routine"; id: string };

export function parseReminderTarget(value: string | null): ReminderTarget | null {
  const match = value ? /^(task|routine):([\w-]+)$/.exec(value) : null;
  return match ? { kind: match[1] as ReminderTarget["kind"], id: match[2] } : null;
}

// Same device-local date arithmetic as the review's "Tomorrow" button (ReviewModal).
function ymdFrom(nowMs: number, addDays: number): string {
  const d = new Date(nowMs);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + addDays);
  return `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
}

function findTask(groups: TaskGroupVM[], target: ReminderTarget) {
  if (target.kind !== "task") return null;
  for (const t of groups.flatMap((g) => g.tasks)) {
    if (t.id === target.id) return { title: t.title, isCompleted: t.isCompleted, detail: t.dueLabel, dueTimeValue: t.dueTimeValue };
    const sub = t.subtasks.find((s) => s.id === target.id);
    if (sub) return { title: sub.title, isCompleted: sub.isCompleted, detail: t.title, dueTimeValue: null };
  }
  return null;
}

const BUTTON = "flex-1 cursor-pointer rounded-full px-3 py-2 text-sm";

export default function ReminderSheet({
  target,
  onClose,
  onShowList,
}: {
  target: ReminderTarget;
  onClose: () => void;
  onShowList: (area: "tasks" | "routines") => void;
}) {
  const { raw, actions, nowMs } = useTaskbook();
  // Derived across both modes: the lists on screen are filtered by the Work/Home toggle, and a
  // reminder for the other side must still find its item.
  const data = useMemo(() => deriveEntities(raw, nowMs, "all"), [raw, nowMs]);

  const task = findTask(data.taskGroups, target);
  const routine = target.kind === "routine" ? (data.routineList.find((r) => r.id === target.id) ?? null) : null;

  const title = task?.title ?? routine?.title ?? null;
  const done = task ? task.isCompleted : routine ? routine.isTicked : false;
  const detail = task ? task.detail : routine ? (routine.subroutines.map((s) => s.title).join(" · ") || routine.dueLabel) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-(--overlay) p-4 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-110 rounded-2xl border border-(--border) bg-(--card) p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] font-serif shadow-[0_20px_60px_rgba(70,55,30,.3)] sm:pb-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Reminder"
      >
        <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">
          {target.kind === "task" ? "Task reminder" : "Routine reminder"}
        </div>
        {title === null ? (
          <p className="py-3 text-sm italic text-(--ink-soft)">This one isn&apos;t in Cura any more — it may have been deleted.</p>
        ) : (
          <>
            <h2 className={`text-xl text-(--ink) ${done ? "line-through opacity-60" : ""}`}>{title}</h2>
            {detail && <p className="mt-1 text-sm text-(--ink-soft)">{detail}</p>}
          </>
        )}

        <div className="mt-4 flex gap-2">
          {task && !task.isCompleted && (
            <>
              <button
                type="button"
                onClick={() => {
                  actions.toggleTask(target.id, false);
                  onClose();
                }}
                className={`${BUTTON} bg-(--accent) text-(--on-accent)`}
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => {
                  actions.setTaskDue(target.id, ymdFrom(nowMs, 1), task.dueTimeValue ?? "");
                  onClose();
                }}
                className={`${BUTTON} bg-[rgba(85,118,148,.1)] text-(--info)`}
              >
                Tomorrow
              </button>
            </>
          )}
          {routine && !routine.isTicked && (
            <button
              type="button"
              onClick={() => {
                actions.tickRoutine(target.id);
                onClose();
              }}
              className={`${BUTTON} bg-(--accent) text-(--on-accent)`}
            >
              Done
            </button>
          )}
          {title !== null && (
            <button
              type="button"
              onClick={() => onShowList(target.kind === "task" ? "tasks" : "routines")}
              className={`${BUTTON} border border-(--border-strong) text-(--ink)`}
            >
              {target.kind === "task" ? "Open Tasks" : "Open Routines"}
            </button>
          )}
          <button type="button" onClick={onClose} className={`${BUTTON} flex-none text-(--ink-muted)`}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
