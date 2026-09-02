"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useModalActions } from "./ModalContext";
import { useTaskbook } from "./store";
import { DateTimePickerPanel } from "./DateTimePicker";
import SearchBar from "./SearchBar";
import { CheckSquare, Chip, labelClass, RowDeleteButton, StrikeSweep } from "./shared";
import { AnimatedList, leavingStyle, useCompletionHold } from "./motion";
import type { RoutineItemVM } from "./types";

export default function RoutinesView({
  routines,
  total,
  query,
  onQueryChange,
}: {
  routines: RoutineItemVM[];
  total: number;
  query: string;
  onQueryChange: (v: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? routines.filter((r) => r.title.toLowerCase().includes(q)) : routines;
  // Up top: what's actually in front of the user — due inside the lookahead window (see
  // ROUTINE_SOON_WINDOW_MS), plus anything ticked off earlier today, which stays visible and
  // struck through until the day rolls over so undoing it is one tap where the eye already is.
  // "Later" is only what its name says: not due for a while, or ticked on an earlier day.
  // A search looks through both halves, so it force-opens the section. The hold below still
  // covers the strike-through animation for a routine that does drop into "Later" on tick.
  const { isHeld, isLeaving, hold } = useCompletionHold();
  const soon = filtered.filter((r) => !r.isLater || isHeld(r.id));
  const later = filtered.filter((r) => r.isLater && !isHeld(r.id));
  const [showLater, setShowLater] = useState(false);
  const laterOpen = showLater || q.length > 0;

  return (
    <div>
      <div className="flex max-w-[680px] items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Routines</div>
        <div className="pb-2.5 text-[13px] text-(--ink-muted)">{total} total</div>
      </div>
      <div className="my-5 mb-1 h-px max-w-[680px] bg-(--rule)" />

      <SearchBar query={query} onQueryChange={onQueryChange} placeholder="Search routines…" />

      {total === 0 && <p className="py-8 text-[15px] italic text-(--ink-soft)">Nothing here yet.</p>}
      {total > 0 && filtered.length === 0 && (
        <p className="py-8 text-[15px] italic text-(--ink-soft)">No routines match your search.</p>
      )}

      {/* One list, not a list plus a "Later" box: the heading and the empty-state line carry flip
          ids alongside the rows, so a routine sinking out of view slides everything below it up
          rather than letting the "Later" heading snap into the gap. */}
      <AnimatedList className="max-w-[680px]">
        {soon.map((r) => (
          <RoutineRow key={r.id} routine={r} onCompleting={hold} leaving={isLeaving(r.id)} />
        ))}

        {!q && soon.length === 0 && later.length > 0 && (
          <p data-flip-id="soon-empty" className="py-8 text-[15px] italic text-(--ink-soft)">
            Nothing due in the next while.
          </p>
        )}

        {later.length > 0 && (
          <Fragment>
            <button
              data-flip-id="later-header"
              type="button"
              onClick={() => setShowLater((v) => !v)}
              className={`${labelClass} flex cursor-pointer items-center gap-1.5`}
              style={{ margin: "20px 0 4px" }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 -960 960 960"
                style={{ transform: laterOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}
              >
                <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" style={{ fill: "var(--ink-soft)" }} />
              </svg>
              Later ({later.length})
            </button>
            {laterOpen && later.map((r) => <RoutineRow key={r.id} routine={r} />)}
          </Fragment>
        )}
      </AnimatedList>
    </div>
  );
}

function RoutineRow({
  routine,
  onCompleting,
  leaving = false,
}: {
  routine: RoutineItemVM;
  onCompleting?: (id: string) => void;
  /** Mid-fade on its way out of this list — see useCompletionHold. */
  leaving?: boolean;
}) {
  const { openEdit } = useModalActions();
  const { actions } = useTaskbook();
  const [addingStep, setAddingStep] = useState(false);
  const [editingPause, setEditingPause] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Purely local scratch state so the user can tick off steps through the day — steps always
  // complete together in the database (see completeRoutineCluster), so there's nothing per-step
  // to persist. Cleared whenever the routine itself un-ticks (manual toggle, or its next
  // occurrence coming round), ready for the next occurrence.
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
      // Un-tick (ticked by mistake, or from the notification's "Done" button) — the old
      // behavior re-ticked, which made a ticked routine impossible to take back.
      actions.untickRoutine(routine.id);
      setStepChecks({});
      return;
    }
    setCompleting(true);
    onCompleting?.(routine.id);
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

  // Urgency colour-coding, identical to TaskRow's: a danger rail and faint wash down the left
  // edge of an overdue routine, the warmer warn tone for one still to come today.
  const urgentInk = routine.urgency === "overdue" ? "var(--danger)" : routine.urgency === "today" ? "var(--warn)" : null;
  const urgentWash = routine.urgency === "overdue" ? "var(--danger-wash)" : "var(--warn-wash)";
  // Same bleed-off-the-rail gradient TaskRow uses, so an overdue routine and an overdue task
  // read as the same thing.
  const urgentFade = `linear-gradient(90deg, ${urgentWash} 0%, transparent 66%)`;

  return (
    <div
      data-flip-id={routine.id}
      className="group border-b border-(--border-soft) py-3.5"
      style={{
        ...(urgentInk ? { borderLeft: `3px solid ${urgentInk}`, paddingLeft: 9, background: urgentFade } : null),
        ...(leaving ? leavingStyle : null),
      }}
    >
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
          {/* A tick holds until the routine is next due, so the date line says which occurrence
              the row is waiting on — today's while it's still outstanding, the next one once it's
              ticked. A routine ticked today shows when it was done, with undo right there. */}
          <div className="relative mt-1 flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
            {routine.isDoneToday ? (
              <>
                <span className="text-xs text-(--ink-faint)">Done {routine.completedAtLabel}</span>
                <button
                  type="button"
                  onClick={handleToggle}
                  className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--accent-text)"
                >
                  Undo
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditingPause((v) => !v)}
                className="cursor-pointer text-xs"
                style={{ color: urgentInk ?? "var(--ink-muted)", fontWeight: urgentInk ? 500 : undefined }}
              >
                {routine.dueLabel}
              </button>
            )}
            {editingPause && (
              <div
                ref={pausePanelRef}
                className="absolute left-0 top-6 z-20 mx-auto w-fit max-w-full rounded-lg border border-(--accent-text) bg-(--card) p-2.5 shadow-[0_8px_24px_rgba(70,55,30,.18)]"
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

      {/* Steps are ticked off one-handed on a phone, so the whole row is the target: a 20px box
          carrying CheckSquare's usual invisible slop, and the title itself toggles too. */}
      {routine.subroutines.length > 0 && (
        <ul className="ml-8.5 mt-2 flex flex-col">
          {routine.subroutines.map((s) => {
            const checked = isStepChecked(s.id);
            return (
              <li key={s.id} className="group/step flex items-center gap-2.5 py-1.5">
                <CheckSquare action={() => toggleStep(s.id)} checked={checked} size={20} />
                <span
                  onClick={() => toggleStep(s.id)}
                  className="flex-1 cursor-pointer text-[15px] leading-5"
                  style={{ color: checked ? "var(--ink-strike)" : "var(--ink-muted)", textDecoration: checked ? "line-through" : "none" }}
                >
                  {s.title}
                </span>
                <button
                  type="button"
                  onClick={() => actions.removeRoutine(s.id)}
                  aria-label="Remove step"
                  className="cursor-pointer text-xs text-(--ink-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover/step:opacity-100 [@media(hover:none)]:opacity-100"
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
