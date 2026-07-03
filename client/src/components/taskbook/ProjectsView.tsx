"use client";

import { useState } from "react";
import { addTask, removeProject, renameProject, toggleTask, updateProjectDescription, updateProjectDueDate } from "@/app/actions";
import { todayInputValue } from "@/lib/taskbookDates";
import { Chip, RowDeleteButton, labelClass } from "./shared";
import type { CategoryOption, ProjectCardVM } from "./types";

const fieldInputClass =
  "w-full rounded-md border border-[#d3c9b3] bg-white px-2 py-1 text-[13.5px] text-[#2a2622] outline-none focus:border-[#17399b]";

export default function ProjectsView({
  cards,
  activeCount,
  query,
  categoryOptions,
}: {
  cards: ProjectCardVM[];
  activeCount: number;
  query: string;
  categoryOptions: CategoryOption[];
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-[#2a2622]">Projects</div>
        <div className="pb-2.5 text-[13px] text-[#8a8069]">{activeCount} active</div>
      </div>
      <div className="my-5 mb-6 h-px bg-[#d5cbb4]" />

      {filtered.length === 0 && (
        <p className="py-8 text-[15px] italic text-[#a49a82]">
          {q ? "No projects match your search." : "Nothing here yet."}
        </p>
      )}

      <div className="grid max-w-[940px] grid-cols-2 gap-5.5">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} categoryOptions={categoryOptions} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, categoryOptions }: { project: ProjectCardVM; categoryOptions: CategoryOption[] }) {
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [addingTask, setAddingTask] = useState(false);

  return (
    <div className="group rounded-xl border border-[#e1d8c4] bg-[#f2ecdf] px-5.5 pb-5 pt-5.5">
      <div className="flex items-baseline justify-between gap-2">
        {editingName ? (
          <form action={renameProject.bind(null, project.id)} onSubmit={() => setEditingName(false)} className="min-w-0 flex-1">
            <input
              name="name"
              required
              autoFocus
              defaultValue={project.name}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingName(false);
              }}
              className="w-full border-b border-[#17399b] bg-transparent text-[21px] font-semibold text-[#2a2622] outline-none"
            />
          </form>
        ) : (
          <div className="cursor-pointer text-[21px] font-semibold text-[#2a2622]" onClick={() => setEditingName(true)}>
            {project.name}
          </div>
        )}
        <div className="flex flex-none items-center gap-2.5">
          <span className="text-[13px] text-[#557694]">
            {project.done} / {project.total}
          </span>
          <RowDeleteButton action={removeProject.bind(null, project.id)} />
        </div>
      </div>

      {editingDescription ? (
        <form action={updateProjectDescription.bind(null, project.id)} onSubmit={() => setEditingDescription(false)} className="mt-1.5">
          <textarea
            name="description"
            rows={2}
            autoFocus
            defaultValue={project.description ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => e.currentTarget.form?.requestSubmit()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingDescription(false);
            }}
            className={fieldInputClass}
          />
        </form>
      ) : (
        <div className="mt-1.5 cursor-pointer text-[13.5px] italic leading-snug text-[#8a8069]" onClick={() => setEditingDescription(true)}>
          {project.description || "Add description"}
        </div>
      )}

      <div className="mt-2">
        {editingDueDate ? (
          <form action={updateProjectDueDate.bind(null, project.id)} onSubmit={() => setEditingDueDate(false)} className="inline-block">
            <input
              type="date"
              name="dueDate"
              autoFocus
              defaultValue={project.dueDateValue}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              onBlur={() => setEditingDueDate(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingDueDate(false);
              }}
              className="rounded-md border border-[#d3c9b3] bg-white px-2 py-1 text-[12.5px] text-[#2a2622] outline-none focus:border-[#17399b]"
            />
          </form>
        ) : (
          <span className="cursor-pointer" onClick={() => setEditingDueDate(true)}>
            <Chip>{project.dueLabel ?? "Set due date"}</Chip>
          </span>
        )}
      </div>

      <div className="my-2.5 mb-4 h-1 overflow-hidden rounded-full bg-[#e1d8c4]">
        <div className="h-full rounded-full bg-[#17399b]" style={{ width: `${project.progressPct}%` }} />
      </div>
      <div className="flex flex-col gap-3">
        {project.preview.map((item) => (
          <div key={item.id} className="flex items-center gap-3">
            <ProjectTaskCheck taskId={item.id} isCompleted={item.isCompleted} />
            <div className="min-w-0 flex-1">
              <span
                className="text-[15px]"
                style={{
                  color: item.isCompleted ? "#a49a82" : "#2a2622",
                  textDecoration: item.isCompleted ? "line-through" : "none",
                }}
              >
                {item.title}
              </span>
              {item.dueLabel && (
                <span className="ml-2">
                  <Chip>{item.dueLabel}</Chip>
                </span>
              )}
            </div>
          </div>
        ))}
        {project.total === 0 &&
          (addingTask ? (
            <form action={addTask} onSubmit={() => setAddingTask(false)} className="flex items-center gap-2">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="category" value={categoryOptions[0]?.name ?? ""} />
              <input
                name="title"
                required
                autoFocus
                placeholder="Task name"
                onBlur={(e) => {
                  const next = e.relatedTarget as Node | null;
                  if (!next || !e.currentTarget.form?.contains(next)) setAddingTask(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingTask(false);
                }}
                className="min-w-0 flex-1 border-b border-[#17399b] bg-transparent text-[15px] text-[#2a2622] outline-none"
              />
              <input
                type="date"
                name="dueDate"
                defaultValue={todayInputValue()}
                onBlur={(e) => {
                  const next = e.relatedTarget as Node | null;
                  if (!next || !e.currentTarget.form?.contains(next)) setAddingTask(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingTask(false);
                }}
                className="flex-none rounded-md border border-[#d3c9b3] bg-white px-1.5 py-0.5 text-[12px] text-[#8a8069] outline-none"
              />
            </form>
          ) : (
            <div className={`${labelClass} cursor-pointer`} onClick={() => setAddingTask(true)}>
              No tasks yet
            </div>
          ))}
        {project.moreCount > 0 && <div className="pl-8 text-[13px] italic text-[#a49a82]">+ {project.moreCount} more</div>}
      </div>
    </div>
  );
}

function ProjectTaskCheck({ taskId, isCompleted }: { taskId: string; isCompleted: boolean }) {
  return (
    <form action={toggleTask.bind(null, taskId, isCompleted)} className="flex-none">
      <button
        type="submit"
        className="flex h-5 w-5 cursor-pointer items-center justify-center rounded"
        style={{
          border: `1.5px solid ${isCompleted ? "#17399b" : "#b3a988"}`,
          background: isCompleted ? "rgba(23,57,155,.06)" : "transparent",
        }}
      >
        {isCompleted && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M4 13.5 L9.5 18.5 L20 5.5" stroke="#17399b" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </form>
  );
}
