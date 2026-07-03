"use client";

import { useState } from "react";
import {
  addCategory,
  addHabit,
  addProject,
  addRoutine,
  addTask,
  editHabit,
  editProject,
  editRoutine,
  editTask,
  removeCategory,
} from "@/app/actions";
import type { CategoryOption, ModalState, ProjectOption } from "./types";

const inputClass =
  "w-full rounded-lg border border-[#d3c9b3] bg-white px-3 py-2 text-sm text-[#2a2622] outline-none focus:border-[#17399b]";
const labelTextClass = "mb-1 block text-[11px] uppercase tracking-[0.14em] text-[#8a8069]";
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayInputValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  const title = `${state.mode === "add" ? "New" : "Edit"} ${state.kind[0].toUpperCase()}${state.kind.slice(1)}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(42,38,34,.35)] p-6" onClick={onClose}>
      <div
        className="w-full max-w-105 rounded-2xl border border-[#ddd4c1] bg-[#faf7ef] p-6 shadow-[0_20px_60px_rgba(70,55,30,.3)] font-serif"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl text-[#2a2622]">{title}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer text-[#8a8069]">
            ✕
          </button>
        </div>

        {state.kind === "task" && (
          <TaskForm state={state} projectOptions={projectOptions} categoryOptions={categoryOptions} onClose={onClose} />
        )}
        {state.kind === "project" && <ProjectForm state={state} onClose={onClose} />}
        {state.kind === "routine" && <RoutineForm state={state} onClose={onClose} />}
        {state.kind === "habit" && <HabitForm state={state} onClose={onClose} />}
      </div>
    </div>
  );
}

function Actions({ submitLabel }: { submitLabel: string }) {
  return (
    <div className="mt-5 flex justify-end gap-2.5">
      <button type="submit" className="cursor-pointer rounded-full bg-[#17399b] px-5 py-2 text-sm text-white">
        {submitLabel}
      </button>
    </div>
  );
}

function TaskForm({
  state,
  projectOptions,
  categoryOptions,
  onClose,
}: {
  state: Extract<NonNullable<ModalState>, { kind: "task" }>;
  projectOptions: ProjectOption[];
  categoryOptions: CategoryOption[];
  onClose: () => void;
}) {
  const action = state.mode === "edit" ? editTask.bind(null, state.item.id) : addTask;
  const item = state.mode === "edit" ? state.item : null;
  const [showManageCategories, setShowManageCategories] = useState(false);

  return (
    <form action={action} onSubmit={onClose} className="flex flex-col gap-3">
      <div>
        <label className={labelTextClass}>Title</label>
        <input name="title" required autoFocus defaultValue={item?.title} className={inputClass} />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <label className={labelTextClass}>Category</label>
          <button
            type="button"
            onClick={() => setShowManageCategories((v) => !v)}
            className="mb-1 cursor-pointer text-[11px] text-[#557694]"
          >
            {showManageCategories ? "Done" : "Manage"}
          </button>
        </div>
        {showManageCategories ? (
          <CategoryManager categoryOptions={categoryOptions} />
        ) : (
          <select name="category" required defaultValue={item?.category ?? categoryOptions[0]?.name ?? ""} className={inputClass}>
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
        <textarea name="description" rows={2} defaultValue={item?.description ?? ""} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelTextClass}>Due date</label>
          <input name="dueDate" type="date" defaultValue={item?.dueDateValue ?? todayInputValue()} className={inputClass} />
        </div>
        <div>
          <label className={labelTextClass}>Project</label>
          <select name="projectId" defaultValue={item?.projectId ?? ""} className={inputClass}>
            <option value="">No project</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Actions submitLabel={state.mode === "edit" ? "Save" : "Add task"} />
    </form>
  );
}

function CategoryManager({ categoryOptions }: { categoryOptions: CategoryOption[] }) {
  const [newName, setNewName] = useState("");

  async function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    const fd = new FormData();
    fd.set("name", name);
    setNewName("");
    await addCategory(fd);
  }

  return (
    <div className="rounded-lg border border-[#d3c9b3] bg-white p-2.5">
      <div className="flex flex-col gap-1.5">
        {categoryOptions.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 text-sm text-[#2a2622]">
            <span>{c.name}</span>
            <button
              type="button"
              onClick={() => removeCategory(c.id)}
              disabled={categoryOptions.length <= 1}
              className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-[#eee5d4] pt-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category"
          className="w-full min-w-0 rounded-md border border-[#d3c9b3] px-2 py-1 text-sm text-[#2a2622] outline-none focus:border-[#17399b]"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="cursor-pointer rounded-md bg-[#17399b] px-2.5 py-1 text-xs text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ProjectForm({
  state,
  onClose,
}: {
  state: Extract<NonNullable<ModalState>, { kind: "project" }>;
  onClose: () => void;
}) {
  const action = state.mode === "edit" ? editProject.bind(null, state.item.id) : addProject;
  const item = state.mode === "edit" ? state.item : null;

  return (
    <form action={action} onSubmit={onClose} className="flex flex-col gap-3">
      <div>
        <label className={labelTextClass}>Name</label>
        <input name="name" required autoFocus defaultValue={item?.name} className={inputClass} />
      </div>
      <div>
        <label className={labelTextClass}>Description</label>
        <textarea name="description" rows={2} defaultValue={item?.description ?? ""} className={inputClass} />
      </div>
      <div>
        <label className={labelTextClass}>Due date</label>
        <input name="dueDate" type="date" defaultValue={item?.dueDateValue} className={inputClass} />
      </div>
      <Actions submitLabel={state.mode === "edit" ? "Save" : "Add project"} />
    </form>
  );
}

function RoutineForm({
  state,
  onClose,
}: {
  state: Extract<NonNullable<ModalState>, { kind: "routine" }>;
  onClose: () => void;
}) {
  const action = state.mode === "edit" ? editRoutine.bind(null, state.item.id) : addRoutine;
  const item = state.mode === "edit" ? state.item : null;
  const [frequency, setFrequency] = useState(item?.frequency ?? "DAILY");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(item?.daysOfWeek ?? []);

  return (
    <form action={action} onSubmit={onClose} className="flex flex-col gap-3">
      <div>
        <label className={labelTextClass}>Title</label>
        <input name="title" required autoFocus defaultValue={item?.title} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelTextClass}>Reminder time</label>
          <input name="reminderTime" required placeholder="08:00" defaultValue={item?.reminderTime} className={inputClass} />
        </div>
        <div>
          <label className={labelTextClass}>Frequency</label>
          <select
            name="frequency"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            className={inputClass}
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>
      </div>
      {frequency === "WEEKLY" && (
        <div>
          <label className={labelTextClass}>Days</label>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((name, idx) => (
              <label key={idx} className="flex items-center gap-1 text-sm text-[#2a2622]">
                <input
                  type="checkbox"
                  name="daysOfWeek"
                  value={idx}
                  checked={daysOfWeek.includes(idx)}
                  onChange={(e) =>
                    setDaysOfWeek((cur) => (e.target.checked ? [...cur, idx] : cur.filter((d) => d !== idx)))
                  }
                />
                {name}
              </label>
            ))}
          </div>
        </div>
      )}
      {frequency === "MONTHLY" && (
        <div>
          <label className={labelTextClass}>Day of month</label>
          <input name="dayOfMonth" type="number" min={1} max={31} defaultValue={item?.dayOfMonth ?? 1} className={inputClass} />
        </div>
      )}
      <Actions submitLabel={state.mode === "edit" ? "Save" : "Add routine"} />
    </form>
  );
}

function HabitForm({
  state,
  onClose,
}: {
  state: Extract<NonNullable<ModalState>, { kind: "habit" }>;
  onClose: () => void;
}) {
  const action = state.mode === "edit" ? editHabit.bind(null, state.item.id) : addHabit;
  const item = state.mode === "edit" ? state.item : null;
  const [frequency, setFrequency] = useState(item?.frequency ?? "DAILY");

  return (
    <form action={action} onSubmit={onClose} className="flex flex-col gap-3">
      <div>
        <label className={labelTextClass}>Title</label>
        <input name="title" required autoFocus defaultValue={item?.title} className={inputClass} />
      </div>
      <div>
        <label className={labelTextClass}>Frequency</label>
        <select
          name="frequency"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          className={inputClass}
        >
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="FORTNIGHTLY">Fortnightly</option>
          <option value="MONTHLY">Monthly</option>
          <option value="CUSTOM">Custom</option>
        </select>
      </div>
      {frequency === "CUSTOM" && (
        <div>
          <label className={labelTextClass}>Every N days</label>
          <input name="customIntervalDays" type="number" min={1} defaultValue={item?.customIntervalDays ?? 2} className={inputClass} />
        </div>
      )}
      <Actions submitLabel={state.mode === "edit" ? "Save" : "Add habit"} />
    </form>
  );
}
