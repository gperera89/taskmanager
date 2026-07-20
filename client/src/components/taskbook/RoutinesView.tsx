"use client";

import { useEffect, useRef, useState } from "react";
import { useModalActions } from "./ModalContext";
import { useTaskbook } from "./store";
import { DateTimePickerPanel } from "./DateTimePicker";
import { CheckSquare, Chip, RowDeleteButton, StrikeSweep } from "./shared";
import type { RoutineItemVM } from "./types";

export default function RoutinesView({
  routines,
  total,
  query,
}: {
  routines: RoutineItemVM[];
  total: number;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? routines.filter((r) => r.title.toLowerCase().includes(q)) : routines;

  return (
    <div>
      <div className="flex max-w-[680px] items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Routines</div>
        <div className="pb-2.5 text-[13px] text-(--ink-muted)">{total} total</div>
      </div>
      <div className="my-5 mb-6 h-px max-w-[680px] bg-(--rule)" />

      {total === 0 && <p className="py-8 text-[15px] italic text-(--ink-soft)">Nothing here yet.</p>}
      {total > 0 && filtered.length === 0 && (
        <p className="py-8 text-[15px] italic text-(--ink-soft)">No routines match your search.</p>
      )}

      <div className="max-w-[680px]">
        {filtered.map((r) => (
          <RoutineRow key={r.id} routine={r} />
        ))}
      </div>
    </div>
  );
}

function RoutineRow({ routine }: { routine: RoutineItemVM }) {
  const { openEdit } = useModalActions();
  const { actions } = useTaskbook();
  const [addingStep, setAddingStep] = useState(false);
  const [editingPause, setEditingPause] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Purely local scratch state so the user can tick off steps through the day — steps always
  // complete together in the database (see completeRoutineCluster), so there's nothing per-step
  // to persist. Cleared whenever the routine itself un-ticks (manual toggle or the hourly
  // auto-reset), ready for the next occurrence.
  const [stepChecks, setStepChecks] = useState<Record<string, boolean>>({});

  // Close the pause calendar on any pointerdown outside it (buttons don't reliably take focus on
  // click in Safari, so onBlur would miss plain clicks-away) — mirrors TaskRow's due-date popover.
  const pausePanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editingPause) return;
    function handlePointerDown(e: PointerEvent) {
      if (pausePanelRef.current?.contains(e.target as Node)) return;
      setEditingPause(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [editingPause]);

  function handleToggle() {
    if (routine.isTicked) {
      // Un-tick (e.g. the cron auto-ticked it on notify but it wasn't actually done) — the
      // old behavior re-ticked, which made a ticked routine impossible to take back.
      actions.untickRoutine(routine.id);
      setStepChecks({});
      return;
    }
    setCompleting(true);
    actions.tickRoutine(routine.id);
    window.setTimeout(() => setCompleting(false), 460);
  }

  function isStepChecked(id: string) {
    return routine.isTicked || (stepChecks[id] ?? false);
  }

  function toggleStep(id: string) {
    if (routine.isTicked) return;
    const next = { ...stepChecks, [id]: !isStepChecked(id) };
    setStepChecks(next);
    if (routine.subroutines.every((s) => next[s.id])) handleToggle();
  }

  return (
    <div className="group border-b border-(--border-soft) py-3.5">
      <div className="flex items-start gap-3">
        <CheckSquare action={handleToggle} checked={routine.isTicked} completing={completing} />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openEdit({ mode: "edit", kind: "routine", item: routine })}>
          <div className="flex items-start justify-between gap-2">
            <span
              className="relative text-base leading-5.5"
              style={{
                color: routine.isTicked ? "var(--ink-soft)" : "var(--ink)",
                textDecoration: routine.isTicked && !completing ? "line-through" : "none",
              }}
            >
              {routine.title}
              {completing && <StrikeSweep />}
            </span>
            {(routine.scheduleLabel || routine.durationLabel) && (
              <div className="hidden flex-col items-end gap-1 lg:flex">
                {routine.scheduleLabel && <Chip>{routine.scheduleLabel}</Chip>}
                {routine.durationLabel && <Chip>◷ {routine.durationLabel}</Chip>}
              </div>
            )}
          </div>
          {routine.isTicked && !routine.scheduleLabel && (
            <div className="mt-0.5 text-xs italic text-(--ink-faint)">auto-resets within the hour</div>
          )}
          <div className="relative mt-1 flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setEditingPause((v) => !v)} className="cursor-pointer text-xs text-(--ink-muted)">
              Next: {routine.nextNotificationLabel}
            </button>
            {editingPause && (
              <div
                ref={pausePanelRef}
                className="absolute left-0 top-6 z-20 w-fit rounded-lg border border-(--accent-text) bg-(--card) p-2.5 shadow-[0_8px_24px_rgba(70,55,30,.18)]"
              >
                <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">Pause until</div>
                <DateTimePickerPanel
                  dateOnly
                  dateValue={routine.pausedUntil ?? ""}
                  timeValue=""
                  onChangeDate={(d) => {
                    actions.setRoutinePause(routine.id, d);
                    setEditingPause(false);
                  }}
                  onChangeTime={() => {}}
                />
              </div>
            )}
            {routine.pausedUntil && (
              <button
                type="button"
                onClick={() => actions.setRoutinePause(routine.id, "")}
                className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
              >
                Clear pause
              </button>
            )}
          </div>
        </div>
        <RowDeleteButton action={() => actions.removeRoutine(routine.id)} />
      </div>

      {routine.subroutines.length > 0 && (
        <ul className="ml-8.5 mt-2 flex flex-col gap-1.5">
          {routine.subroutines.map((s) => {
            const checked = isStepChecked(s.id);
            return (
              <li key={s.id} className="group/step flex items-center gap-2">
                <CheckSquare action={() => toggleStep(s.id)} checked={checked} size={16} />
                <span
                  className="flex-1 text-[13px]"
                  style={{ color: checked ? "var(--ink-strike)" : "var(--ink-muted)", textDecoration: checked ? "line-through" : "none" }}
                >
                  {s.title}
                </span>
                <button
                  type="button"
                  onClick={() => actions.removeRoutine(s.id)}
                  aria-label="Remove step"
                  className="cursor-pointer text-xs text-(--ink-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover/step:opacity-100"
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="ml-8.5 mt-1.5">
        {addingStep ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
              if (title) actions.addSubroutine(routine.id, title);
              setAddingStep(false);
            }}
            className="flex items-center gap-2"
          >
            <input
              name="title"
              required
              autoFocus
              placeholder="e.g. Make coffee"
              className="rounded-md border border-(--border-strong) bg-(--card) px-2 py-1 text-[13px] text-(--ink) outline-none focus:border-(--accent-text)"
            />
            <button type="submit" className="cursor-pointer text-[13px] text-(--info)">
              Add
            </button>
            <button type="button" onClick={() => setAddingStep(false)} className="cursor-pointer text-[13px] text-(--ink-faint)">
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAddingStep(true)} className="cursor-pointer text-[13px] text-(--info)">
            + Add step
          </button>
        )}
      </div>
    </div>
  );
}
