"use client";

import { useState } from "react";
import { addSubroutine, removeRoutine, tickRoutine } from "@/app/actions";
import { useModalActions } from "./ModalContext";
import { Chip, RowDeleteButton, labelClass } from "./shared";
import type { RoutineItemVM } from "./types";

export default function RoutinesView({
  daily,
  scheduled,
  total,
  query,
}: {
  daily: RoutineItemVM[];
  scheduled: RoutineItemVM[];
  total: number;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const filteredDaily = q ? daily.filter((r) => r.title.toLowerCase().includes(q)) : daily;
  const filteredScheduled = q ? scheduled.filter((r) => r.title.toLowerCase().includes(q)) : scheduled;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-[#2a2622]">Routines</div>
        <div className="pb-2.5 text-[13px] text-[#8a8069]">{total} total</div>
      </div>
      <div className="my-5 mb-6 h-px bg-[#d5cbb4]" />

      {total === 0 && <p className="py-8 text-[15px] italic text-[#a49a82]">Nothing here yet.</p>}
      {total > 0 && filteredDaily.length === 0 && filteredScheduled.length === 0 && (
        <p className="py-8 text-[15px] italic text-[#a49a82]">No routines match your search.</p>
      )}

      <div className="grid max-w-[900px] grid-cols-2 gap-11">
        {filteredDaily.length > 0 && (
          <div>
            <div className={`${labelClass} mb-1.5`}>Every day</div>
            {filteredDaily.map((r) => (
              <RoutineRow key={r.id} routine={r} />
            ))}
          </div>
        )}
        {filteredScheduled.length > 0 && (
          <div>
            <div className={`${labelClass} mb-1.5`}>On a schedule</div>
            {filteredScheduled.map((r) => (
              <RoutineRow key={r.id} routine={r} showChip />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoutineRow({ routine, showChip = false }: { routine: RoutineItemVM; showChip?: boolean }) {
  const { openEdit } = useModalActions();
  const [addingStep, setAddingStep] = useState(false);

  return (
    <div className="group border-b border-[#e1d8c4] py-3.5">
      <div className="flex items-center gap-3">
        <form action={tickRoutine.bind(null, routine.id)} className="flex-none">
          <button
            type="submit"
            className="flex h-5.5 w-5.5 cursor-pointer items-center justify-center rounded"
            style={{
              border: `1.5px solid ${routine.isTicked ? "#17399b" : "#b3a988"}`,
              background: routine.isTicked ? "rgba(23,57,155,.06)" : "transparent",
            }}
          >
            {routine.isTicked && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M4 13.5 L9.5 18.5 L20 5.5" stroke="#17399b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </form>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => openEdit({ mode: "edit", kind: "routine", item: routine })}>
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-base"
              style={{ color: routine.isTicked ? "#a49a82" : "#2a2622", textDecoration: routine.isTicked ? "line-through" : "none" }}
            >
              {routine.title}
            </span>
            {showChip && routine.scheduleLabel && <Chip>{routine.scheduleLabel}</Chip>}
          </div>
          {routine.isTicked && !showChip && <div className="mt-0.5 text-xs italic text-[#b3a988]">auto-resets within the hour</div>}
        </div>
        <RowDeleteButton action={removeRoutine.bind(null, routine.id)} />
      </div>

      {routine.subroutines.length > 0 && (
        <ul className="ml-8.5 mt-2 flex flex-col gap-1">
          {routine.subroutines.map((s) => (
            <li key={s.id} className="group/step flex items-center justify-between gap-2">
              <span
                className="text-[13px]"
                style={{ color: routine.isTicked ? "#c2b89f" : "#8a8069", textDecoration: routine.isTicked ? "line-through" : "none" }}
              >
                · {s.title}
              </span>
              <form action={removeRoutine.bind(null, s.id)} className="opacity-0 transition-opacity group-hover/step:opacity-100">
                <button type="submit" aria-label="Remove step" className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040]">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <div className="ml-8.5 mt-1.5">
        {addingStep ? (
          <form
            action={async (formData) => {
              await addSubroutine(routine.id, formData);
              setAddingStep(false);
            }}
            className="flex items-center gap-2"
          >
            <input
              name="title"
              required
              autoFocus
              placeholder="e.g. Make coffee"
              className="rounded-md border border-[#d3c9b3] bg-white px-2 py-1 text-[13px] text-[#2a2622] outline-none focus:border-[#17399b]"
            />
            <button type="submit" className="cursor-pointer text-[13px] text-[#557694]">
              Add
            </button>
            <button type="button" onClick={() => setAddingStep(false)} className="cursor-pointer text-[13px] text-[#b3a988]">
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAddingStep(true)} className="cursor-pointer text-[13px] text-[#557694]">
            + Add step
          </button>
        )}
      </div>
    </div>
  );
}
