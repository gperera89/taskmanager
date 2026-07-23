"use client";

import { useEffect, useRef, useState } from "react";
import { SelectField } from "./shared";

const inputClass =
  "w-full rounded-lg border border-(--border-strong) bg-(--card) px-3 py-2 text-sm text-(--ink) outline-none focus:border-(--accent-text)";
const labelTextClass = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Displayed Monday-first to match how people actually think about a week; daysOfWeek values
// underneath are still 0=Sunday..6=Saturday throughout the rest of the app.
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHLY_ORDINAL_OPTIONS = [
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: 5, label: "Fifth" },
  { value: -1, label: "Last" },
];

type Frequency = "" | "DAILY" | "WEEKLY" | "MONTHLY";
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "", label: "Does not repeat" },
  { value: "DAILY", label: "Day" },
  { value: "WEEKLY", label: "Week" },
  { value: "MONTHLY", label: "Month" },
];

export type RepeatInitial = {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | null;
  interval: number;
  daysOfWeek: number[];
  monthlyMode: "DATE" | "WEEKDAY";
  dayOfMonth: number | null;
  monthlyOrdinal: number | null;
  monthlyWeekday: number | null;
  repeatUntil: string | null; // yyyy-mm-dd series end date, null = repeats forever
};

// Task recurrence controls — same shape of rule as Routines, but tasks default to "does not
// repeat" and roll their one dueDate forward on completion rather than tracking a perpetual
// schedule. Field names (repeatFrequency, repeatInterval, ...) match actions.ts's parseTaskRepeat.
export default function RepeatFields({
  initial,
  anchorDate,
  onChange,
}: {
  initial?: RepeatInitial;
  anchorDate?: Date;
  // Fires with the current rule on every change, for callers that want to auto-save instead of
  // reading the hidden inputs at outer-form submit time (see TasksView's repeat popover).
  onChange?: (rule: RepeatInitial) => void;
}) {
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? "");
  const [intervalStr, setIntervalStr] = useState(String(initial?.interval ?? 1));
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initial?.daysOfWeek ?? []);
  const [monthlyMode, setMonthlyMode] = useState(initial?.monthlyMode ?? "DATE");
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth ?? (anchorDate ?? new Date()).getDate());
  const [monthlyOrdinal, setMonthlyOrdinal] = useState(initial?.monthlyOrdinal ?? 1);
  const [monthlyWeekday, setMonthlyWeekday] = useState(initial?.monthlyWeekday ?? (anchorDate ?? new Date()).getDay());
  const [repeatUntil, setRepeatUntil] = useState(initial?.repeatUntil ?? "");
  const isSingular = intervalStr === "1";

  // Skip the very first run so opening the popover doesn't immediately re-save the unchanged
  // rule — only fire once something actually changes.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onChange?.({
      frequency: frequency || null,
      interval: Number(intervalStr) || 1,
      daysOfWeek,
      monthlyMode,
      dayOfMonth,
      monthlyOrdinal,
      monthlyWeekday,
      repeatUntil: repeatUntil || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, intervalStr, daysOfWeek, monthlyMode, dayOfMonth, monthlyOrdinal, monthlyWeekday, repeatUntil]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={labelTextClass}>Repeat</label>
        <div className="flex gap-1 rounded-lg border border-(--border-strong) p-1">
          {FREQUENCY_OPTIONS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFrequency(f.value)}
              className="flex-1 cursor-pointer rounded-md py-1.5 text-xs"
              style={{
                background: frequency === f.value ? "var(--accent)" : "transparent",
                color: frequency === f.value ? "var(--on-accent)" : "var(--ink-muted)",
              }}
            >
              {f.value && !isSingular ? `${f.label}s` : f.label}
            </button>
          ))}
        </div>
      </div>
      <input type="hidden" name="repeatFrequency" value={frequency} />

      {frequency !== "" && (
        <>
          <div>
            <label className={labelTextClass}>Every</label>
            <input
              name="repeatInterval"
              required
              inputMode="numeric"
              pattern="[0-9]*"
              value={intervalStr}
              onChange={(e) => setIntervalStr(e.target.value.replace(/\D/g, ""))}
              className={`${inputClass} w-16! shrink-0 text-center`}
            />
          </div>

          {frequency === "WEEKLY" && (
            <div>
              <label className={labelTextClass}>On these days</label>
              <div className="flex gap-1.5">
                {WEEKDAY_DISPLAY_ORDER.map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setDaysOfWeek((cur) => (cur.includes(idx) ? cur.filter((d) => d !== idx) : [...cur, idx]))}
                    className="flex h-8.5 w-8.5 cursor-pointer items-center justify-center rounded-full text-xs"
                    style={{
                      background: daysOfWeek.includes(idx) ? "var(--accent)" : "transparent",
                      color: daysOfWeek.includes(idx) ? "var(--on-accent)" : "var(--ink-muted)",
                      border: daysOfWeek.includes(idx) ? "none" : "1px solid var(--border-strong)",
                    }}
                  >
                    {DAY_NAMES[idx][0]}
                  </button>
                ))}
              </div>
              {daysOfWeek.map((d) => (
                <input key={d} type="hidden" name="repeatDaysOfWeek" value={d} />
              ))}
            </div>
          )}

          {frequency === "MONTHLY" && (
            <div>
              <label className={labelTextClass}>On</label>
              <div className="mb-2.5 flex gap-1 rounded-full border border-(--border-strong) p-1">
                {(["DATE", "WEEKDAY"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMonthlyMode(mode)}
                    className="flex-1 cursor-pointer rounded-full py-1.5 text-xs"
                    style={{
                      background: monthlyMode === mode ? "var(--accent)" : "transparent",
                      color: monthlyMode === mode ? "var(--on-accent)" : "var(--ink-muted)",
                    }}
                  >
                    {mode === "DATE" ? "Each date" : "On the"}
                  </button>
                ))}
              </div>
              <input type="hidden" name="repeatMonthlyMode" value={monthlyMode} />

              {monthlyMode === "DATE" ? (
                <>
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setDayOfMonth(day)}
                        className="flex h-7.5 w-7.5 cursor-pointer items-center justify-center rounded-full text-[11px]"
                        style={{
                          background: dayOfMonth === day ? "var(--accent)" : "transparent",
                          color: dayOfMonth === day ? "var(--on-accent)" : "var(--ink)",
                        }}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDayOfMonth(-1)}
                    className="mt-1.5 w-full cursor-pointer rounded-lg py-1.5 text-xs"
                    style={{
                      background: dayOfMonth === -1 ? "var(--accent)" : "transparent",
                      color: dayOfMonth === -1 ? "var(--on-accent)" : "var(--info)",
                      border: dayOfMonth === -1 ? "none" : "1px solid var(--border-strong)",
                    }}
                  >
                    Last day of the month
                  </button>
                  <input type="hidden" name="repeatDayOfMonth" value={dayOfMonth} />
                </>
              ) : (
                <div className="grid grid-cols-2 items-start gap-3">
                  <SelectField
                    name="repeatMonthlyOrdinal"
                    value={String(monthlyOrdinal)}
                    onChange={(v) => setMonthlyOrdinal(Number(v))}
                    options={MONTHLY_ORDINAL_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                    className={inputClass}
                  />
                  <SelectField
                    name="repeatMonthlyWeekday"
                    value={String(monthlyWeekday)}
                    onChange={(v) => setMonthlyWeekday(Number(v))}
                    options={WEEKDAY_FULL_NAMES.map((name, idx) => ({ value: String(idx), label: name }))}
                    className={inputClass}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className={labelTextClass}>Ends</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                name="repeatUntil"
                value={repeatUntil}
                min={anchorDate ? anchorDate.toISOString().slice(0, 10) : undefined}
                onChange={(e) => setRepeatUntil(e.target.value)}
                className={`${inputClass} w-auto`}
              />
              {repeatUntil ? (
                <button
                  type="button"
                  onClick={() => setRepeatUntil("")}
                  className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                >
                  Never
                </button>
              ) : (
                <span className="text-xs italic text-(--ink-ghost)">Repeats forever</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
