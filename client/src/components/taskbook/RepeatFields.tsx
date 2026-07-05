"use client";

import { useEffect, useRef, useState } from "react";

const inputClass =
  "w-full rounded-lg border border-[#d3c9b3] bg-white px-3 py-2 text-sm text-[#2a2622] outline-none focus:border-[#17399b]";
const labelTextClass = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#8a8069]";
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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, intervalStr, daysOfWeek, monthlyMode, dayOfMonth, monthlyOrdinal, monthlyWeekday]);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className={labelTextClass}>Repeat</label>
        <div className="flex gap-1 rounded-lg border border-[#d3c9b3] p-1">
          {FREQUENCY_OPTIONS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFrequency(f.value)}
              className="flex-1 cursor-pointer rounded-md py-1.5 text-xs"
              style={{
                background: frequency === f.value ? "#17399b" : "transparent",
                color: frequency === f.value ? "#fff" : "#8a8069",
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
                      background: daysOfWeek.includes(idx) ? "#17399b" : "transparent",
                      color: daysOfWeek.includes(idx) ? "#fff" : "#8a8069",
                      border: daysOfWeek.includes(idx) ? "none" : "1px solid #d3c9b3",
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
              <div className="mb-2.5 flex gap-1 rounded-full border border-[#d3c9b3] p-1">
                {(["DATE", "WEEKDAY"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setMonthlyMode(mode)}
                    className="flex-1 cursor-pointer rounded-full py-1.5 text-xs"
                    style={{
                      background: monthlyMode === mode ? "#17399b" : "transparent",
                      color: monthlyMode === mode ? "#fff" : "#8a8069",
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
                          background: dayOfMonth === day ? "#17399b" : "transparent",
                          color: dayOfMonth === day ? "#fff" : "#2a2622",
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
                      background: dayOfMonth === -1 ? "#17399b" : "transparent",
                      color: dayOfMonth === -1 ? "#fff" : "#557694",
                      border: dayOfMonth === -1 ? "none" : "1px solid #d3c9b3",
                    }}
                  >
                    Last day of the month
                  </button>
                  <input type="hidden" name="repeatDayOfMonth" value={dayOfMonth} />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <select
                    name="repeatMonthlyOrdinal"
                    value={monthlyOrdinal}
                    onChange={(e) => setMonthlyOrdinal(Number(e.target.value))}
                    className={inputClass}
                  >
                    {MONTHLY_ORDINAL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select
                    name="repeatMonthlyWeekday"
                    value={monthlyWeekday}
                    onChange={(e) => setMonthlyWeekday(Number(e.target.value))}
                    className={inputClass}
                  >
                    {WEEKDAY_FULL_NAMES.map((name, idx) => (
                      <option key={idx} value={idx}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
