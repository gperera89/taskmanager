"use client";

import { removeTask, toggleTask } from "@/app/actions";
import { useModalActions } from "./ModalContext";
import { Chip, CheckSquare, RowDeleteButton, labelClass } from "./shared";
import type { TaskGroupVM, TaskItemVM } from "./types";

export default function TasksView({
  groups,
  remainingToday,
  query,
}: {
  groups: TaskGroupVM[];
  remainingToday: number;
  query: string;
}) {
  const { openEdit } = useModalActions();
  const q = query.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({ ...g, tasks: q ? g.tasks.filter((t) => t.title.toLowerCase().includes(q)) : g.tasks }))
    .filter((g) => g.tasks.length > 0);

  return (
    <div>
      <div className="flex max-w-[680px] items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-[#2a2622]">Tasks</div>
        <div className="pb-2.5 text-[13px] text-[#8a8069]">{remainingToday} remaining today</div>
      </div>
      <div className="my-5 mt-5 mb-1 h-px max-w-[680px] bg-[#d5cbb4]" />

      <div className="max-w-[680px]">
        {filtered.length === 0 && (
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
              <TaskRow key={task.id} task={task} onEdit={() => openEdit({ mode: "edit", kind: "task", item: task })} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task, onEdit }: { task: TaskItemVM; onEdit: () => void }) {
  const hasSubtasks = task.subtasksTotal > 0;
  const progressPct = hasSubtasks ? Math.round((task.subtasksDone / task.subtasksTotal) * 100) : 0;

  return (
    <div className="group flex gap-3.5 border-b border-[#e1d8c4] py-3.5 px-0.5">
      <CheckSquare action={toggleTask.bind(null, task.id, task.isCompleted)} checked={task.isCompleted} />
      <div className="min-w-0 flex-1 cursor-pointer" onClick={onEdit}>
        <div
          className="text-[17px]"
          style={{ color: task.isCompleted ? "#a49a82" : "#2a2622", textDecoration: task.isCompleted ? "line-through" : "none" }}
        >
          {task.title}
        </div>
        {task.description && <div className="mt-0.5 text-[13.5px] leading-snug text-[#8a8069]">{task.description}</div>}
        {task.projectName && (
          <div className="mt-1.5">
            <Chip variant="project">{task.projectName}</Chip>
          </div>
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
      <div className="flex flex-none flex-col items-end gap-1.5 pt-0.5">
        {task.dueLabel && <span className="text-[12.5px] text-[#b3a988]">{task.dueLabel}</span>}
        <RowDeleteButton action={removeTask.bind(null, task.id)} />
      </div>
    </div>
  );
}
