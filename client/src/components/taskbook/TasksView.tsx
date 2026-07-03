"use client";

import { useState } from "react";
import {
  removeTask,
  renameTask,
  toggleTask,
  updateTaskCategory,
  updateTaskDescription,
  updateTaskDueDate,
  updateTaskProject,
  updateTaskRepeat,
} from "@/app/actions";
import { CheckSquare, RowDeleteButton, labelClass } from "./shared";
import RepeatFields from "./RepeatFields";
import type { CategoryOption, ProjectOption, TaskGroupVM, TaskItemVM } from "./types";

export default function TasksView({
  groups,
  remainingToday,
  query,
  categoryOptions,
  projectOptions,
}: {
  groups: TaskGroupVM[];
  remainingToday: number;
  query: string;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const q = query.trim().toLowerCase();

  const matchesQuery = (t: TaskItemVM) => !q || t.title.toLowerCase().includes(q);
  const filtered = groups
    .map((g) => ({ ...g, tasks: g.tasks.filter((t) => matchesQuery(t) && !t.isCompleted) }))
    .filter((g) => g.tasks.length > 0);
  const completedTasks = groups.flatMap((g) => g.tasks.filter((t) => matchesQuery(t) && t.isCompleted));

  return (
    <div>
      <div className="flex max-w-[680px] items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-[#2a2622]">Tasks</div>
        <div className="pb-2.5 text-[13px] text-[#8a8069]">{remainingToday} remaining today</div>
      </div>
      <div className="my-5 mt-5 mb-1 h-px max-w-[680px] bg-[#d5cbb4]" />

      <div className="max-w-[680px]">
        {filtered.length === 0 && completedTasks.length === 0 && (
          <p className="py-8 text-[15px] italic text-[#a49a82]">
            {q ? "No tasks match your search." : "Nothing here yet."}
          </p>
        )}
        {filtered.map((group) => (
          <div key={group.key}>
            <div className={labelClass} style={{ margin: "20px 0 4px" }}>
              {group.label}
            </div>
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} categoryOptions={categoryOptions} projectOptions={projectOptions} />
            ))}
          </div>
        ))}

        {completedTasks.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className={`${labelClass} flex cursor-pointer items-center gap-1.5`}
              style={{ margin: "20px 0 4px" }}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                style={{ transform: showCompleted ? "rotate(90deg)" : "none", transition: "transform .15s" }}
              >
                <path d="M8 5l8 7-8 7" stroke="#a49a82" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Completed ({completedTasks.length})
            </button>
            {showCompleted &&
              completedTasks.map((task) => (
                <TaskRow key={task.id} task={task} categoryOptions={categoryOptions} projectOptions={projectOptions} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

const chipSelectClass =
  "cursor-pointer whitespace-nowrap rounded-full border-none px-2.5 py-0.5 text-[11.5px] outline-none";

function TaskRow({
  task,
  categoryOptions,
  projectOptions,
}: {
  task: TaskItemVM;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
}) {
  const hasSubtasks = task.subtasksTotal > 0;
  const progressPct = hasSubtasks ? Math.round((task.subtasksDone / task.subtasksTotal) * 100) : 0;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState(task.dueDateValue);
  const [dueTimeDraft, setDueTimeDraft] = useState(task.dueTimeValue);
  const [repeatOpen, setRepeatOpen] = useState(false);

  async function commitTitle() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(task.title);
      return;
    }
    if (trimmed === task.title) return;
    const fd = new FormData();
    fd.set("title", trimmed);
    await renameTask(task.id, fd);
  }

  async function commitDescription() {
    setEditingDescription(false);
    if (descriptionDraft === (task.description ?? "")) return;
    const fd = new FormData();
    fd.set("description", descriptionDraft);
    await updateTaskDescription(task.id, fd);
  }

  async function commitCategory(name: string) {
    const fd = new FormData();
    fd.set("category", name);
    await updateTaskCategory(task.id, fd);
  }

  async function commitProject(projectId: string) {
    const fd = new FormData();
    fd.set("projectId", projectId);
    await updateTaskProject(task.id, fd);
  }

  async function commitDue() {
    const fd = new FormData();
    fd.set("dueDate", dueDateDraft);
    fd.set("dueTime", dueTimeDraft);
    await updateTaskDueDate(task.id, fd);
    setDueOpen(false);
  }

  async function clearDue() {
    const fd = new FormData();
    fd.set("dueDate", "");
    fd.set("dueTime", "");
    await updateTaskDueDate(task.id, fd);
    setDueDateDraft("");
    setDueTimeDraft("");
    setDueOpen(false);
  }

  return (
    <div className="group flex gap-3.5 border-b border-[#e1d8c4] py-3.5 px-0.5">
      <CheckSquare action={toggleTask.bind(null, task.id, task.isCompleted)} checked={task.isCompleted} />
      <div className="min-w-0 flex-1">
        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                setTitleDraft(task.title);
                setEditingTitle(false);
              }
            }}
            className="w-full rounded border border-[#17399b] bg-white px-1.5 py-0.5 text-[17px] text-[#2a2622] outline-none"
          />
        ) : (
          <div
            className="cursor-text text-[17px]"
            style={{ color: task.isCompleted ? "#a49a82" : "#2a2622", textDecoration: task.isCompleted ? "line-through" : "none" }}
            onClick={() => setEditingTitle(true)}
          >
            {task.title}
          </div>
        )}

        {editingDescription ? (
          <textarea
            autoFocus
            rows={2}
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDescriptionDraft(task.description ?? "");
                setEditingDescription(false);
              }
            }}
            className="mt-1 w-full rounded border border-[#17399b] bg-white px-1.5 py-1 text-[13.5px] text-[#2a2622] outline-none"
          />
        ) : task.description ? (
          <div
            className="mt-0.5 cursor-text text-[13.5px] leading-snug text-[#8a8069]"
            onClick={() => setEditingDescription(true)}
          >
            {task.description}
          </div>
        ) : (
          <div className="mt-0.5 cursor-text text-[13.5px] italic text-[#c4bba3]" onClick={() => setEditingDescription(true)}>
            Add description
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select
            value={task.category}
            onChange={(e) => commitCategory(e.target.value)}
            className={chipSelectClass}
            style={{ color: "#557694", background: "rgba(85,118,148,.1)" }}
          >
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={task.projectId ?? ""}
            onChange={(e) => commitProject(e.target.value)}
            className={chipSelectClass}
            style={{ color: "#8a8069", background: "rgba(138,128,105,.13)" }}
          >
            <option value="">No project</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setRepeatOpen((v) => !v)}
            className={chipSelectClass}
            style={{
              color: task.repeatLabel ? "#557694" : "#b3a988",
              background: task.repeatLabel ? "rgba(85,118,148,.1)" : "transparent",
              border: task.repeatLabel ? "none" : "1px dashed #d3c9b3",
            }}
          >
            {task.repeatLabel ? `↻ ${task.repeatLabel}` : "Repeat"}
          </button>

          <button
            type="button"
            onClick={() => setDueOpen((v) => !v)}
            className={chipSelectClass}
            style={{
              color: task.dueLabel ? "#557694" : "#b3a988",
              background: task.dueLabel ? "rgba(85,118,148,.1)" : "transparent",
              border: task.dueLabel ? "none" : "1px dashed #d3c9b3",
            }}
          >
            {task.dueLabel ?? "Set date"}
          </button>
        </div>

        {dueOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#d3c9b3] bg-white p-2.5">
            <input
              type="date"
              value={dueDateDraft}
              onChange={(e) => setDueDateDraft(e.target.value)}
              className="rounded border border-[#d3c9b3] px-1.5 py-1 text-xs text-[#2a2622] outline-none focus:border-[#17399b]"
            />
            <input
              type="time"
              value={dueTimeDraft}
              onChange={(e) => setDueTimeDraft(e.target.value)}
              className="rounded border border-[#d3c9b3] px-1.5 py-1 text-xs text-[#2a2622] outline-none focus:border-[#17399b]"
            />
            <button type="button" onClick={commitDue} className="cursor-pointer rounded-md bg-[#17399b] px-2.5 py-1 text-xs text-white">
              Save
            </button>
            {task.dueDateValue && (
              <button type="button" onClick={clearDue} className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040]">
                Clear
              </button>
            )}
            <button type="button" onClick={() => setDueOpen(false)} className="cursor-pointer text-xs text-[#8a8069]">
              Cancel
            </button>
          </div>
        )}

        {repeatOpen && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await updateTaskRepeat(task.id, fd);
              setRepeatOpen(false);
            }}
            className="mt-2 rounded-lg border border-[#d3c9b3] bg-white p-3"
          >
            <RepeatFields
              initial={{
                frequency: task.repeatFrequency,
                interval: task.repeatInterval,
                daysOfWeek: task.repeatDaysOfWeek,
                monthlyMode: task.repeatMonthlyMode,
                dayOfMonth: task.repeatDayOfMonth,
                monthlyOrdinal: task.repeatMonthlyOrdinal,
                monthlyWeekday: task.repeatMonthlyWeekday,
              }}
              anchorDate={task.dueDateValue ? new Date(`${task.dueDateValue}T00:00:00`) : undefined}
            />
            <div className="mt-3 flex justify-end gap-2.5">
              <button type="button" onClick={() => setRepeatOpen(false)} className="cursor-pointer text-xs text-[#8a8069]">
                Cancel
              </button>
              <button type="submit" className="cursor-pointer rounded-md bg-[#17399b] px-3 py-1.5 text-xs text-white">
                Save
              </button>
            </div>
          </form>
        )}

        {hasSubtasks && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-[#557694]">
              {task.subtasksDone} of {task.subtasksTotal} subtasks
            </span>
            <span className="relative inline-block h-[3px] w-[100px] overflow-hidden rounded-full bg-[#e1d8c4]">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[#557694]" style={{ width: `${progressPct}%` }} />
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-none items-start pt-0.5">
        <RowDeleteButton action={removeTask.bind(null, task.id)} />
      </div>
    </div>
  );
}
