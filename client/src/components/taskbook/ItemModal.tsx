"use client";

import { useEffect, useRef, useState } from "react";
import { REMINDER_LEAD_OPTIONS } from "@/lib/shared";
import { todayInputValue } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import {
  isValidHabitForm,
  isValidRoutineForm,
  isValidTaskForm,
  parseHabitForm,
  parseProjectForm,
  parseRoutineForm,
  parseTaskForm,
} from "./formParse";
import CategoryManager from "./CategoryManager";
import { DateTimePickerPanel, formatPickerLabel } from "./DateTimePicker";
import RepeatFields from "./RepeatFields";
import { AutoGrowTextarea } from "./shared";
import type { CategoryOption, HabitCardVM, ModalState, ProjectCardVM, ProjectOption, RoutineItemVM } from "./types";

const inputClass =
  "w-full rounded-lg border border-(--border-strong) bg-(--card) px-3 py-2 text-sm text-(--ink) outline-none focus:border-(--accent-text)";
const labelTextClass = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Displayed Monday-first to match how people actually think about a week; daysOfWeek values
// underneath are still 0=Sunday..6=Saturday throughout the rest of the app.
const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ROUTINE_FREQUENCY_OPTIONS: { value: "DAILY" | "WEEKLY" | "MONTHLY"; singular: string; plural: string }[] = [
  { value: "DAILY", singular: "Day", plural: "Days" },
  { value: "WEEKLY", singular: "Week", plural: "Weeks" },
  { value: "MONTHLY", singular: "Month", plural: "Months" },
];
const MONTHLY_ORDINAL_OPTIONS = [
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: 5, label: "Fifth" },
  { value: -1, label: "Last" },
];
const WEEKDAY_FULL_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Kind = "task" | "project" | "routine" | "habit";

const KIND_TABS: { kind: Kind; name: string }[] = [
  { kind: "task", name: "Task" },
  { kind: "project", name: "Project" },
  { kind: "routine", name: "Routine" },
  { kind: "habit", name: "Habit" },
];

// The title/name field carries over when switching kind in Add mode, so starting a Task and
// then deciding it's really a Project doesn't lose what was already typed.
type SharedTitleProps = { titleValue: string; onTitleChange: (v: string) => void };
type SharedDescriptionProps = { descriptionValue: string; onDescriptionChange: (v: string) => void };

export default function ItemModal({
  state,
  projectOptions,
  categoryOptions,
  onClose,
}: {
  state: NonNullable<ModalState>;
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  onClose: () => void;
}) {
  const isAdd = state.mode === "add";
  const [addKind, setAddKind] = useState<Kind>(state.mode === "add" ? state.initialKind ?? "task" : "task");
  const [sharedTitle, setSharedTitle] = useState("");
  const [sharedDescription, setSharedDescription] = useState("");

  const kind = isAdd ? addKind : state.kind;
  const heading = `${isAdd ? "New" : "Edit"} ${kind[0].toUpperCase()}${kind.slice(1)}`;
  const shared = { titleValue: sharedTitle, onTitleChange: setSharedTitle };
  const sharedWithDescription = { ...shared, descriptionValue: sharedDescription, onDescriptionChange: setSharedDescription };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-(--overlay) p-6" onClick={onClose}>
      <div
        className="w-full max-w-105 rounded-2xl border border-(--border) bg-(--card) p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl text-(--ink)">{heading}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-(--ink-muted)">
            <svg width="18" height="18" viewBox="0 -960 960 960">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" style={{ fill: "var(--ink-muted)" }} />
            </svg>
          </button>
        </div>

        {isAdd && (
          <div className="mb-4 flex gap-1 rounded-full border border-(--border-strong) p-1">
            {KIND_TABS.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setAddKind(k.kind)}
                className="flex-1 cursor-pointer rounded-full py-1.5 text-xs"
                style={{
                  background: addKind === k.kind ? "var(--accent)" : "transparent",
                  color: addKind === k.kind ? "var(--on-accent)" : "var(--ink-muted)",
                }}
              >
                {k.name}
              </button>
            ))}
          </div>
        )}

        {isAdd ? (
          // All four forms stay mounted, stacked in the same grid cell, so the grid row sizes
          // to the tallest one — switching tabs never shrinks/grows the modal (and re-picking a
          // tab keeps whatever was already typed into it, since nothing unmounts).
          <div className="grid grid-cols-1">
            <div className={`col-start-1 row-start-1 ${addKind === "task" ? "" : "invisible"}`}>
              <fieldset disabled={addKind !== "task"} className="contents">
                <TaskForm projectOptions={projectOptions} categoryOptions={categoryOptions} onClose={onClose} shared={sharedWithDescription} />
              </fieldset>
            </div>
            <div className={`col-start-1 row-start-1 ${addKind === "project" ? "" : "invisible"}`}>
              <fieldset disabled={addKind !== "project"} className="contents">
                <ProjectForm item={null} onClose={onClose} shared={sharedWithDescription} />
              </fieldset>
            </div>
            <div className={`col-start-1 row-start-1 ${addKind === "routine" ? "" : "invisible"}`}>
              <fieldset disabled={addKind !== "routine"} className="contents">
                <RoutineForm item={null} onClose={onClose} shared={shared} />
              </fieldset>
            </div>
            <div className={`col-start-1 row-start-1 ${addKind === "habit" ? "" : "invisible"}`}>
              <fieldset disabled={addKind !== "habit"} className="contents">
                <HabitForm item={null} onClose={onClose} shared={shared} />
              </fieldset>
            </div>
          </div>
        ) : (
          <>
            {state.kind === "project" && <ProjectForm item={state.item} onClose={onClose} />}
            {state.kind === "routine" && <RoutineForm item={state.item} onClose={onClose} />}
            {state.kind === "habit" && <HabitForm item={state.item} onClose={onClose} />}
          </>
        )}
      </div>
    </div>
  );
}

function Actions({ submitLabel }: { submitLabel: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2.5">
      <button type="submit" className="cursor-pointer rounded-full bg-(--accent) px-5 py-2 text-sm text-(--on-accent)">
        {submitLabel}
      </button>
    </div>
  );
}

// Tasks are only ever created here — editing an existing task happens inline on its row
// (see TasksView), so this form has no `item` prop and always submits to addTask.
function TaskForm({
  projectOptions,
  categoryOptions,
  onClose,
  shared,
}: {
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  onClose: () => void;
  shared?: SharedTitleProps & SharedDescriptionProps;
}) {
  const { actions } = useTaskbook();
  const [showManageCategories, setShowManageCategories] = useState(false);
  const [dueDate, setDueDate] = useState(todayInputValue());
  const [dueTime, setDueTime] = useState("");
  const [dueOpen, setDueOpen] = useState(false);

  // A click-away close, not an onBlur one — macOS Safari never focuses a <button> on click,
  // so an onBlur-based "closed when focus leaves" check misses plain clicks outside the panel.
  const duePanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dueOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (!duePanelRef.current?.contains(e.target as Node)) setDueOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dueOpen]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = parseTaskForm(new FormData(e.currentTarget));
        if (isValidTaskForm(input)) actions.addTask(input);
        onClose();
      }}
      className="flex flex-col gap-3"
    >
      <div>
        <label className={labelTextClass}>Title</label>
        {shared ? (
          <input
            name="title"
            required
            autoFocus
            value={shared.titleValue}
            onChange={(e) => shared.onTitleChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <input name="title" required autoFocus className={inputClass} />
        )}
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className={labelTextClass}>Category</label>
          <button
            type="button"
            onClick={() => setShowManageCategories((v) => !v)}
            className="mb-1 cursor-pointer text-[11px] text-(--info)"
          >
            {showManageCategories ? "Done" : "Manage"}
          </button>
        </div>
        {showManageCategories ? (
          <CategoryManager categoryOptions={categoryOptions} />
        ) : (
          <select name="category" required defaultValue={categoryOptions[0]?.name ?? ""} className={inputClass}>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div>
        <label className={labelTextClass}>Description</label>
        {shared ? (
          <AutoGrowTextarea
            name="description"
            rows={2}
            value={shared.descriptionValue}
            onChange={(e) => shared.onDescriptionChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <AutoGrowTextarea name="description" rows={2} className={inputClass} />
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-35 flex-1">
          <label className={labelTextClass}>Due</label>
          <input type="hidden" name="dueDate" value={dueDate} />
          <input type="hidden" name="dueTime" value={dueTime} />
          <button
            type="button"
            onClick={() => setDueOpen(!dueOpen)}
            className={`${inputClass} cursor-pointer text-left`}
          >
            {formatPickerLabel(dueDate, dueTime)}
          </button>
        </div>
        <div className="min-w-35 flex-1">
          <label className={labelTextClass}>Project</label>
          <select name="projectId" defaultValue="" className={inputClass}>
            <option value="">No project</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {dueDate && (
        <div>
          <label className={labelTextClass}>Remind me</label>
          <select name="reminderLeadMinutes" defaultValue="" className={inputClass}>
            {REMINDER_LEAD_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {dueOpen && (
        <div ref={duePanelRef} className="w-fit rounded-lg border border-(--accent-text) bg-(--card) p-2.5">
          <DateTimePickerPanel dateValue={dueDate} timeValue={dueTime} onChangeDate={setDueDate} onChangeTime={setDueTime} />
          <button
            type="button"
            onClick={() => {
              setDueDate("");
              setDueTime("");
            }}
            className="mt-2 cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
          >
            Clear
          </button>
        </div>
      )}
      <RepeatFields />
      <Actions submitLabel="Add task" />
    </form>
  );
}

function ProjectForm({
  item,
  onClose,
  shared,
}: {
  item: ProjectCardVM | null;
  onClose: () => void;
  shared?: SharedTitleProps & SharedDescriptionProps;
}) {
  const { actions, data } = useTaskbook();
  // Add mode only: start from an existing project instead of blank — the server copies its
  // tasks/sections with dates and completion reset (see duplicateProject).
  const [templateId, setTemplateId] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = parseProjectForm(fd);
        if (input.name) {
          if (item) actions.editProject(item.id, input);
          else if (templateId) actions.duplicateProject(templateId, input.name);
          else actions.addProject(input);
        }
        onClose();
      }}
      className="flex flex-col gap-3"
    >
      {!item && data.projectOptions.length > 0 && (
        <div>
          <label className={labelTextClass}>Start from</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputClass}>
            <option value="">Blank project</option>
            {data.projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                Copy of: {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={labelTextClass}>Name</label>
        {shared ? (
          <input
            name="name"
            required
            autoFocus
            value={shared.titleValue}
            onChange={(e) => shared.onTitleChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <input name="name" required autoFocus defaultValue={item?.name} className={inputClass} />
        )}
      </div>
      <div>
        <label className={labelTextClass}>Description</label>
        {shared ? (
          <AutoGrowTextarea
            name="description"
            rows={2}
            value={shared.descriptionValue}
            onChange={(e) => shared.onDescriptionChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <AutoGrowTextarea name="description" rows={2} defaultValue={item?.description ?? ""} className={inputClass} />
        )}
      </div>
      <div>
        <label className={labelTextClass}>Due date</label>
        <input name="dueDate" type="date" defaultValue={item?.dueDateValue} className={inputClass} />
      </div>
      <div>
        <label className={labelTextClass}>Remind me</label>
        <select name="reminderLeadMinutes" defaultValue={item?.reminderLeadMinutes ?? ""} className={inputClass}>
          {REMINDER_LEAD_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ""}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <Actions submitLabel={item ? "Save" : "Add project"} />
    </form>
  );
}

function RoutineForm({
  item,
  onClose,
  shared,
}: {
  item: RoutineItemVM | null;
  onClose: () => void;
  shared?: SharedTitleProps;
}) {
  const { actions } = useTaskbook();
  const [frequency, setFrequency] = useState(item?.frequency ?? "DAILY");
  const [intervalStr, setIntervalStr] = useState(String(item?.interval ?? 1));
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(item?.daysOfWeek ?? []);
  const [monthlyMode, setMonthlyMode] = useState(item?.monthlyMode ?? "DATE");
  const [dayOfMonth, setDayOfMonth] = useState(item?.dayOfMonth ?? new Date().getDate());
  const [monthlyOrdinal, setMonthlyOrdinal] = useState(item?.monthlyOrdinal ?? 1);
  const [monthlyWeekday, setMonthlyWeekday] = useState(item?.monthlyWeekday ?? new Date().getDay());
  const isSingular = intervalStr === "1";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = parseRoutineForm(new FormData(e.currentTarget));
        if (isValidRoutineForm(input)) {
          if (item) actions.editRoutine(item.id, input);
          else actions.addRoutine(input);
        }
        onClose();
      }}
      className="flex flex-col gap-3"
    >
      <div>
        <label className={labelTextClass}>Title</label>
        {shared ? (
          <input
            name="title"
            required
            autoFocus
            value={shared.titleValue}
            onChange={(e) => shared.onTitleChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <input name="title" required autoFocus defaultValue={item?.title} className={inputClass} />
        )}
      </div>
      <div>
        <label className={labelTextClass}>Reminder time</label>
        <input name="reminderTime" required placeholder="08:00" defaultValue={item?.reminderTime} className={inputClass} />
      </div>
      <div>
        <label className={labelTextClass}>Repeat every</label>
        <div className="flex gap-2">
          <input
            required
            inputMode="numeric"
            pattern="[0-9]*"
            value={intervalStr}
            onChange={(e) => setIntervalStr(e.target.value.replace(/\D/g, ""))}
            className={`${inputClass} w-16! shrink-0 text-center`}
          />
          <div className="flex flex-1 gap-1 rounded-lg border border-(--border-strong) p-1">
            {ROUTINE_FREQUENCY_OPTIONS.map((f) => (
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
                {isSingular ? f.singular : f.plural}
              </button>
            ))}
          </div>
        </div>
      </div>
      <input type="hidden" name="frequency" value={frequency} />
      <input type="hidden" name="interval" value={intervalStr || "1"} />

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
            <input key={d} type="hidden" name="daysOfWeek" value={d} />
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
          <input type="hidden" name="monthlyMode" value={monthlyMode} />

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
              <input type="hidden" name="dayOfMonth" value={dayOfMonth} />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <select
                name="monthlyOrdinal"
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
                name="monthlyWeekday"
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

      <Actions submitLabel={item ? "Save" : "Add routine"} />
    </form>
  );
}

const HABIT_UNIT_OPTIONS: { unit: "DAY" | "WEEK" | "MONTH"; singular: string; plural: string }[] = [
  { unit: "DAY", singular: "Day", plural: "Days" },
  { unit: "WEEK", singular: "Week", plural: "Weeks" },
  { unit: "MONTH", singular: "Month", plural: "Months" },
];

function HabitForm({
  item,
  onClose,
  shared,
}: {
  item: HabitCardVM | null;
  onClose: () => void;
  shared?: SharedTitleProps;
}) {
  const { actions } = useTaskbook();
  const [intervalValue, setIntervalValue] = useState(String(item?.intervalValue ?? 1));
  const [intervalUnit, setIntervalUnit] = useState<"DAY" | "WEEK" | "MONTH">(item?.intervalUnit ?? "DAY");
  const isSingular = intervalValue === "1";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = parseHabitForm(new FormData(e.currentTarget));
        if (isValidHabitForm(input)) {
          if (item) actions.editHabit(item.id, input);
          else actions.addHabit(input);
        }
        onClose();
      }}
      className="flex flex-col gap-3"
    >
      <div>
        <label className={labelTextClass}>Title</label>
        {shared ? (
          <input
            name="title"
            required
            autoFocus
            value={shared.titleValue}
            onChange={(e) => shared.onTitleChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <input name="title" required autoFocus defaultValue={item?.title} className={inputClass} />
        )}
      </div>
      <div>
        <label className={labelTextClass}>Repeat every</label>
        <div className="flex gap-2">
          <input
            name="intervalValue"
            required
            inputMode="numeric"
            pattern="[0-9]*"
            value={intervalValue}
            onChange={(e) => setIntervalValue(e.target.value.replace(/\D/g, ""))}
            className={`${inputClass} w-16! shrink-0 text-center`}
          />
          <div className="flex flex-1 gap-1 rounded-lg border border-(--border-strong) p-1">
            {HABIT_UNIT_OPTIONS.map((u) => (
              <button
                key={u.unit}
                type="button"
                onClick={() => setIntervalUnit(u.unit)}
                className="flex-1 cursor-pointer rounded-md py-1.5 text-xs"
                style={{
                  background: intervalUnit === u.unit ? "var(--accent)" : "transparent",
                  color: intervalUnit === u.unit ? "var(--on-accent)" : "var(--ink-muted)",
                }}
              >
                {isSingular ? u.singular : u.plural}
              </button>
            ))}
          </div>
          <input type="hidden" name="intervalUnit" value={intervalUnit} />
        </div>
      </div>
      <Actions submitLabel={item ? "Save" : "Add habit"} />
    </form>
  );
}
