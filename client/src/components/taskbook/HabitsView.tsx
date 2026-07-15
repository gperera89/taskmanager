"use client";

import { useEffect, useState } from "react";
import { useModalActions } from "./ModalContext";
import { useTaskbook } from "./store";
import { RowDeleteButton } from "./shared";
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
  habits,
  atRiskCount,
  query,
}: {
  habits: HabitCardVM[];
  atRiskCount: number;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? habits.filter((h) => h.title.toLowerCase().includes(q)) : habits;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Habits</div>
        <div className="pb-2.5 text-[13px] text-(--ink-muted)">{atRiskCount} needs attention</div>
      </div>
      <div className="my-5 mb-6 h-px bg-(--rule)" />

      {habits.length === 0 && <p className="py-8 text-[15px] italic text-(--ink-soft)">Nothing here yet.</p>}

      <div className="max-w-[640px]">
        {!q && habits.length > 0 && <HabitsQuoteBanner />}

        {filtered.map((h) => (
          <HabitRow key={h.id} habit={h} />
        ))}
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
  const { openEdit, openHeatmap } = useModalActions();
  const { actions } = useTaskbook();
  return (
    <div className="group flex items-center justify-between gap-3 border-b border-(--border-soft) py-3.5">
      <div
        className="min-w-0 flex-1 cursor-pointer"
        onClick={() => openHeatmap(habit.id)}
        title="View completion history"
      >
        <div className="text-base text-(--ink)">{habit.title}</div>
        <div className="mt-0.5 text-xs text-(--ink-muted)">
          {habit.detailLabel}
          {habit.durationLabel && ` · ◷ ${habit.durationLabel}`}
        </div>
      </div>
      <div className="flex flex-none items-center gap-2.5">
        <button
          type="button"
          onClick={() => openEdit({ mode: "edit", kind: "habit", item: habit })}
          title="Edit habit"
          aria-label="Edit habit"
          className="flex flex-none cursor-pointer items-center justify-center rounded-full p-1 text-(--ink-soft) opacity-0 transition-opacity hover:text-(--ink) group-hover:opacity-100"
        >
          <PencilIcon />
        </button>
        <span
          className="tabular-nums text-[13px] text-(--ink-muted)"
          title={`${habit.progressDone} of ${habit.progressTarget} ${habit.detailLabel.includes("month") ? "this month" : "this week"}`}
        >
          {habit.progressDone}/{habit.progressTarget}
        </span>
        <HabitFlameButton habit={habit} />
        <RowDeleteButton action={() => actions.removeHabit(habit.id)} />
      </div>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

// Mask-based icon (rather than an inline path) so it stays in sync with, and recolors/animates
// from, the flame asset in /public — "lit" (steady or flickering, blue) vs "lapsed" (grey, out).
function HabitFlameButton({ habit }: { habit: HabitCardVM }) {
  const { actions } = useTaskbook();
  const [igniting, setIgniting] = useState(false);

  function handleComplete() {
    if (habit.isDoneToday) return;
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
      disabled={habit.isDoneToday}
      title={habit.isDoneToday ? "Done today" : "Mark done today"}
      aria-label={habit.isDoneToday ? "Habit completed today" : "Mark habit done today"}
      className={`flex flex-none items-center justify-center rounded-full p-1 transition-transform ${
        habit.isDoneToday ? "cursor-default" : "cursor-pointer hover:scale-110"
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
