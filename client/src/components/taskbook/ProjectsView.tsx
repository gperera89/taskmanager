"use client";

import { removeProject, toggleTask } from "@/app/actions";
import { useModalActions } from "./ModalContext";
import { Chip, RowDeleteButton, labelClass } from "./shared";
import type { ProjectCardVM } from "./types";

export default function ProjectsView({
  cards,
  activeCount,
  query,
}: {
  cards: ProjectCardVM[];
  activeCount: number;
  query: string;
}) {
  const { openEdit } = useModalActions();
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
          <div key={project.id} className="group rounded-xl border border-[#e1d8c4] bg-[#f2ecdf] px-5.5 pb-5 pt-5.5">
            <div className="flex items-baseline justify-between gap-2">
              <div
                className="cursor-pointer text-[21px] font-semibold text-[#2a2622]"
                onClick={() => openEdit({ mode: "edit", kind: "project", item: project })}
              >
                {project.name}
              </div>
              <div className="flex flex-none items-center gap-2.5">
                <span className="text-[13px] text-[#557694]">
                  {project.done} / {project.total}
                </span>
                <RowDeleteButton action={removeProject.bind(null, project.id)} />
              </div>
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
              {project.total === 0 && <div className={labelClass}>No tasks yet</div>}
              {project.moreCount > 0 && (
                <div className="pl-8 text-[13px] italic text-[#a49a82]">+ {project.moreCount} more</div>
              )}
            </div>
          </div>
        ))}
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
