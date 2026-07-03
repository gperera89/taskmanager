"use client";

import { useState } from "react";
import { markHabitDone, removeHabit } from "@/app/actions";
import { useModalActions } from "./ModalContext";
import { RowDeleteButton, labelClass } from "./shared";
import type { HabitCardVM } from "./types";

export default function HabitsView({
  featured,
  suggested,
  onTrack,
  atRiskCount,
  query,
}: {
  featured: HabitCardVM | null;
  suggested: HabitCardVM[];
  onTrack: HabitCardVM[];
  atRiskCount: number;
  query: string;
}) {
  const [skippedId, setSkippedId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const showFeatured = featured && featured.id !== skippedId && (!q || featured.title.toLowerCase().includes(q));
  const filteredSuggested = q ? suggested.filter((h) => h.title.toLowerCase().includes(q)) : suggested;
  const filteredOnTrack = q ? onTrack.filter((h) => h.title.toLowerCase().includes(q)) : onTrack;
  const isEmpty = !featured && suggested.length === 0 && onTrack.length === 0;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-[#2a2622]">Habits</div>
        <div className="pb-2.5 text-[13px] text-[#8a8069]">{atRiskCount} needs attention</div>
      </div>
      <div className="my-5 mb-6 h-px bg-[#d5cbb4]" />

      {isEmpty && <p className="py-8 text-[15px] italic text-[#a49a82]">Nothing here yet.</p>}

      <div className="max-w-[920px]">
        {showFeatured && featured && (
          <div
            className="flex items-center justify-between gap-6 rounded-xl px-6 py-5"
            style={{ border: featured.atRisk ? "1.5px solid #17399b" : "1.5px solid #e1d8c4" }}
          >
            <div>
              <div className={labelClass} style={{ color: featured.atRisk ? "#17399b" : "#8a8069" }}>
                {featured.atRisk ? "Keep the streak" : "Up next"}
              </div>
              <div className="mt-1.5 text-[22px] text-[#2a2622]">{featured.title}</div>
              <div className="mt-0.5 text-sm italic text-[#8a8069]">{featured.detailLabel}</div>
            </div>
            <div className="flex flex-none gap-2.5">
              <form action={markHabitDone.bind(null, featured.id)}>
                <button type="submit" className="cursor-pointer rounded-full bg-[#17399b] px-5 py-2 text-sm text-white">
                  Done today
                </button>
              </form>
              <button
                type="button"
                onClick={() => setSkippedId(featured.id)}
                className="cursor-pointer rounded-full border border-[#c3b9a1] px-5 py-2 text-sm text-[#557694]"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        <div className="mt-6.5 grid grid-cols-2 gap-11">
          {filteredSuggested.length > 0 && (
            <div>
              <div className={`${labelClass} mb-1.5`}>Suggested next</div>
              {filteredSuggested.map((h) => (
                <HabitRow key={h.id} habit={h} />
              ))}
            </div>
          )}
          {filteredOnTrack.length > 0 && (
            <div>
              <div className={`${labelClass} mb-1.5`}>On track</div>
              {filteredOnTrack.map((h) => (
                <HabitRow key={h.id} habit={h} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HabitRow({ habit }: { habit: HabitCardVM }) {
  const { openEdit } = useModalActions();
  return (
    <div className="group flex items-center justify-between gap-3 border-b border-[#e1d8c4] py-3.5">
      <div className="min-w-0 cursor-pointer" onClick={() => openEdit({ mode: "edit", kind: "habit", item: habit })}>
        <div className="text-base text-[#2a2622]">{habit.title}</div>
        <div className="mt-0.5 text-xs text-[#8a8069]">{habit.detailLabel}</div>
      </div>
      <div className="flex flex-none items-center gap-3">
        <div className="text-right">
          <div className="text-[17px] font-semibold text-[#557694]">{habit.currentStreak}</div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-[#a49a82]">streak</div>
        </div>
        <RowDeleteButton action={removeHabit.bind(null, habit.id)} />
      </div>
    </div>
  );
}
