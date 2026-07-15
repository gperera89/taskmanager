"use client";

import { useEffect, useState } from "react";
import { useModalActions } from "./ModalContext";
import { useTaskbook } from "./store";
import { RowDeleteButton, labelClass } from "./shared";
import type { HabitCardVM } from "./types";

// From James Clear's Atomic Habits — rotated in the space the "up next" card used to occupy
// (that card always ended up pinned to a daily habit, since a daily period is always the
// soonest to expire, so it never actually rotated to anything else).
const HABIT_QUOTES = [
  "You should be far more concerned with your current trajectory than with your current results.",
  "Habits are the compound interest of self-improvement.",
  "Every action you take is a vote for the type of person you wish to become.",
  "Success is the product of daily habits—not once-in-a-lifetime transformations.",
];

export default function HabitsView({
  suggested,
  onTrack,
  atRiskCount,
  query,
}: {
  suggested: HabitCardVM[];
  onTrack: HabitCardVM[];
  atRiskCount: number;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const filteredSuggested = q ? suggested.filter((h) => h.title.toLowerCase().includes(q)) : suggested;
  const filteredOnTrack = q ? onTrack.filter((h) => h.title.toLowerCase().includes(q)) : onTrack;
  const isEmpty = suggested.length === 0 && onTrack.length === 0;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Habits</div>
        <div className="pb-2.5 text-[13px] text-(--ink-muted)">{atRiskCount} needs attention</div>
      </div>
      <div className="my-5 mb-6 h-px bg-(--rule)" />

      {isEmpty && <p className="py-8 text-[15px] italic text-(--ink-soft)">Nothing here yet.</p>}

      <div className="max-w-[920px]">
        {!q && <HabitsQuoteBanner />}

        <div className="mt-6.5 grid grid-cols-1 gap-11 lg:grid-cols-2">
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

function HabitsQuoteBanner() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * HABIT_QUOTES.length));
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % HABIT_QUOTES.length), 9000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mb-6.5 rounded-xl px-6 py-5" style={{ border: "1.5px solid var(--border-soft)" }}>
      <div key={index} className="text-[17px] italic text-(--ink-quote) animate-[quote-fade_0.6s_ease]">
        “{HABIT_QUOTES[index]}”
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.16em] text-(--ink-soft)">James Clear · Atomic Habits</div>
    </div>
  );
}

function HabitRow({ habit }: { habit: HabitCardVM }) {
  const { openEdit } = useModalActions();
  const { actions } = useTaskbook();
  return (
    <div className="group flex items-center justify-between gap-3 border-b border-(--border-soft) py-3.5">
      <div className="min-w-0 cursor-pointer" onClick={() => openEdit({ mode: "edit", kind: "habit", item: habit })}>
        <div className="text-base text-(--ink)">{habit.title}</div>
        <div className="mt-0.5 text-xs text-(--ink-muted)">
          {habit.detailLabel}
          {habit.durationLabel && ` · ◷ ${habit.durationLabel}`}
        </div>
      </div>
      <div className="flex flex-none items-center gap-3">
        <HabitFlameButton habit={habit} />
        <RowDeleteButton action={() => actions.removeHabit(habit.id)} />
      </div>
    </div>
  );
}

// Mask-based icon (rather than an inline path) so it stays in sync with, and recolors/animates
// from, the flame asset in /public — "lit" (steady or flickering, blue) vs "lapsed" (grey, out).
function HabitFlameButton({ habit }: { habit: HabitCardVM }) {
  const { actions } = useTaskbook();
  const [igniting, setIgniting] = useState(false);

  function handleComplete() {
    if (habit.isDoneThisPeriod) return;
    actions.markHabitDone(habit.id);
    setIgniting(true);
    window.setTimeout(() => setIgniting(false), 650);
  }

  const status: "lit" | "flicker" | "out" = habit.lapsed ? "out" : habit.atRisk ? "flicker" : "lit";
  const color = status === "out" ? "var(--ink-disabled)" : "var(--accent-text)";
  const animationClass = igniting
    ? "animate-[flame-ignite_0.6s_ease]"
    : status === "flicker"
      ? "animate-[flame-flicker_1.8s_ease-in-out_infinite]"
      : "";

  return (
    <button
      type="button"
      onClick={handleComplete}
      disabled={habit.isDoneThisPeriod}
      title={habit.isDoneThisPeriod ? "Done for this period" : "Mark done"}
      aria-label={habit.isDoneThisPeriod ? "Habit completed" : "Mark habit done"}
      className={`flex flex-none items-center justify-center rounded-full p-1 transition-transform ${
        habit.isDoneThisPeriod ? "cursor-default" : "cursor-pointer hover:scale-110"
      }`}
    >
      <span
        aria-hidden
        className={animationClass}
        style={{
          display: "block",
          width: 24,
          height: 24,
          backgroundColor: color,
          opacity: status === "out" ? 0.55 : 1,
          filter: status === "out" ? undefined : "drop-shadow(0 0 3px rgba(23,57,155,.45))",
          WebkitMaskImage: "url(/mode_heat_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg)",
          maskImage: "url(/mode_heat_24dp_1F1F1F_FILL0_wght400_GRAD0_opsz24.svg)",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    </button>
  );
}
