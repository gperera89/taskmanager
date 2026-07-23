"use client";

import { useEffect, useRef, useState } from "react";
import { todayInputValue } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import { parseTaskForm } from "./formParse";
import { AutoGrowTextarea, Chip, labelClass, useCompletionHold } from "./shared";
import { DateTimePickerPanel, formatPickerLabel } from "./DateTimePicker";
import { TaskRow } from "./TasksView";
import type { CategoryOption, ProjectCardVM, ProjectOption } from "./types";

const fieldInputClass =
  "w-full rounded-md border border-(--border-strong) bg-(--card) px-2 py-1 text-[13.5px] text-(--ink) outline-none focus:border-(--accent-text)";

const VIEW_MODES = ["unchecked", "all", "none"] as const;
type ProjectViewMode = (typeof VIEW_MODES)[number];
const VIEW_MODE_LABEL: Record<ProjectViewMode, string> = {
  unchecked: "Showing unchecked tasks — click to show all",
  all: "Showing all tasks — click to collapse",
  none: "Collapsed — click to show unchecked tasks",
};
// Material Symbols "arrow_circle_down" / "arrow_drop_down_circle" / "arrow_circle_up" glyphs —
// down (fully open) for "all", the lighter drop-down glyph for the partial "unchecked" default,
// up (tucked away) for "none" (collapsed).
const VIEW_MODE_ICON_PATH: Record<ProjectViewMode, string> = {
  all: "m480-320 160-160-56-56-64 64v-168h-80v168l-64-64-56 56 160 160Zm0 240q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
  unchecked:
    "m480-360 160-160H320l160 160Zm0 280q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
  none: "M440-320h80v-168l64 64 56-56-160-160-160 160 56 56 64-64v168Zm40 240q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z",
};

// Card actions (sections/duplicate/delete) live in this kebab dropdown — as inline text
// buttons they overflowed the header row on narrower cards. Menu styling matches the app's
// other custom dropdowns (DurationField / MyDayPlanner's PushMenu).
function ProjectActionsMenu({ project }: { project: ProjectCardVM }) {
  const { actions } = useTaskbook();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-away close, not onBlur — macOS Safari never focuses a <button> on click (see the
  // same pattern on ItemModal's due panel).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const itemBaseClass = "block w-full cursor-pointer whitespace-nowrap px-3 py-1.5 text-left text-[13px]";
  const itemClass = `${itemBaseClass} text-(--ink) hover:bg-[rgba(85,118,148,.08)]`;
  const dangerItemClass = `${itemBaseClass} text-(--danger) hover:bg-[rgba(178,58,44,.08)]`;

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={wrapRef} className="relative flex flex-none items-center">
      <button
        type="button"
        title="Project options"
        aria-label={`Options for ${project.name}`}
        onClick={() => setOpen((v) => !v)}
        className={`flex cursor-pointer items-center justify-center text-(--ink-soft) transition-opacity hover:text-(--info) ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {/* Material Symbols "more_vert" */}
        <svg width="17" height="17" viewBox="0 -960 960 960">
          <path
            d="M480-160q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm0-240q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-240q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z"
            style={{ fill: "currentColor" }}
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-(--border-strong) bg-(--card) py-1 shadow-[0_8px_24px_rgba(70,55,30,.14)]">
          <button
            type="button"
            title={
              project.sectionsEnabled
                ? "Remove section headings (tasks keep their order)"
                : "Group this project's tasks under section headings"
            }
            onClick={() =>
              pick(() => {
                if (
                  project.sectionsEnabled &&
                  project.sectionNames.length > 0 &&
                  !window.confirm("Remove sections? Tasks stay, but lose their section headings.")
                )
                  return;
                actions.setProjectSections(project.id, !project.sectionsEnabled);
              })
            }
            className={itemClass}
          >
            {project.sectionsEnabled ? "Remove sections" : "Create sections"}
          </button>
          <button
            type="button"
            title="Duplicate as a fresh copy (templates)"
            onClick={() =>
              pick(() => {
                const name = window.prompt("Name for the copy", `${project.name} copy`);
                if (name !== null) actions.duplicateProject(project.id, name.trim() || `${project.name} copy`);
              })
            }
            className={itemClass}
          >
            Duplicate
          </button>
          <button
            type="button"
            title="Delete"
            onClick={() => pick(() => actions.removeProject(project.id))}
            className={dangerItemClass}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectExpandToggle({ mode, onCycle }: { mode: ProjectViewMode; onCycle: () => void }) {
  const label = VIEW_MODE_LABEL[mode];
  return (
    <button
      type="button"
      onClick={onCycle}
      title={label}
      aria-label={label}
      className="flex flex-none cursor-pointer items-center justify-center text-(--ink-soft)"
    >
      <svg width="17" height="17" viewBox="0 -960 960 960">
        <path d={VIEW_MODE_ICON_PATH[mode]} style={{ fill: "var(--ink-soft)" }} />
      </svg>
    </button>
  );
}

export default function ProjectsView({
  cards,
  activeCount,
  query,
  categoryOptions,
  projectOptions,
}: {
  cards: ProjectCardVM[];
  activeCount: number;
  query: string;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
}) {
  const q = query.trim().toLowerCase();
  const filtered = q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Projects</div>
        <div className="pb-2.5 text-[13px] text-(--ink-muted)">{activeCount} active</div>
      </div>
      <div className="my-5 mb-6 h-px bg-(--rule)" />

      {filtered.length === 0 && (
        <p className="py-8 text-[15px] italic text-(--ink-soft)">
          {q ? "No projects match your search." : "Nothing here yet."}
        </p>
      )}

      <div className="grid max-w-[940px] grid-cols-1 gap-5.5 lg:grid-cols-2">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} categoryOptions={categoryOptions} projectOptions={projectOptions} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  categoryOptions,
  projectOptions,
}: {
  project: ProjectCardVM;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
}) {
  const { actions } = useTaskbook();
  const { isHeld, hold } = useCompletionHold();
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskDueDate, setNewTaskDueDate] = useState(todayInputValue());
  const [newTaskDueTime, setNewTaskDueTime] = useState("");
  const [newTaskDueOpen, setNewTaskDueOpen] = useState(false);
  const addTaskFormRef = useRef<HTMLFormElement>(null);
  const newTaskDuePanelRef = useRef<HTMLDivElement>(null);
  // A single click-away listener drives both the calendar panel and the whole add-task row —
  // relying on onBlur/relatedTarget here is unreliable once focus moves between two <button>s
  // (the date trigger and a calendar day), so this mirrors the click-away pattern used by
  // ItemModal/TaskRow's own due-date panels instead.
  useEffect(() => {
    if (!addingTask) return;
    function onPointerDown(e: PointerEvent) {
      const form = addTaskFormRef.current;
      if (!form) return;
      const target = e.target as Node;
      if (newTaskDuePanelRef.current?.contains(target)) return;
      if (form.contains(target)) {
        if (newTaskDueOpen) setNewTaskDueOpen(false);
        return;
      }
      setNewTaskDueOpen(false);
      const title = form.elements.namedItem("title") as HTMLInputElement | null;
      if (title?.value.trim()) form.requestSubmit();
      else setAddingTask(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [addingTask, newTaskDueOpen]);
  const [viewMode, setViewMode] = useState<ProjectViewMode>("unchecked");
  const cycleViewMode = () =>
    setViewMode((mode) => VIEW_MODES[(VIEW_MODES.indexOf(mode) + 1) % VIEW_MODES.length]);
  // Sections keep their grouping under every view mode; a section with nothing visible drops out.
  const visibleSections =
    viewMode === "none"
      ? []
      : project.sections
          .map((s) => ({
            ...s,
            tasks: viewMode === "unchecked" ? s.tasks.filter((t) => !t.isCompleted || isHeld(t.id)) : s.tasks,
          }))
          .filter((s) => s.tasks.length > 0);
  const visibleCount = visibleSections.reduce((n, s) => n + s.tasks.length, 0);

  return (
    <div className="group rounded-xl border border-(--border-soft) bg-(--card-tint) px-5.5 pb-5 pt-5.5">
      <div className="flex items-baseline justify-between gap-2">
        {editingName ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
              if (name) actions.renameProject(project.id, name);
              setEditingName(false);
            }}
            className="min-w-0 flex-1"
          >
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
              className="w-full border-b border-(--accent-text) bg-transparent text-[21px] font-semibold text-(--ink) outline-none"
            />
          </form>
        ) : (
          <div className="cursor-pointer text-[21px] font-semibold text-(--ink)" onClick={() => setEditingName(true)}>
            {project.name}
          </div>
        )}
        <div className="flex flex-none items-center gap-2.5">
          <span className="text-[13px] text-(--info)">
            {project.done} / {project.total}
          </span>
          <ProjectExpandToggle mode={viewMode} onCycle={cycleViewMode} />
          <ProjectActionsMenu project={project} />
        </div>
      </div>

      {editingDescription ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            actions.setProjectDescription(project.id, String(new FormData(e.currentTarget).get("description") ?? ""));
            setEditingDescription(false);
          }}
          className="mt-1.5"
        >
          <AutoGrowTextarea
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
        <div className="mt-1.5 cursor-pointer text-[13.5px] italic leading-snug text-(--ink-muted)" onClick={() => setEditingDescription(true)}>
          {project.description || "Add description"}
        </div>
      )}

      <div className="mt-2">
        {editingDueDate ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              actions.setProjectDueDate(project.id, String(new FormData(e.currentTarget).get("dueDate") ?? ""));
              setEditingDueDate(false);
            }}
            className="inline-block"
          >
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
              className="rounded-md border border-(--border-strong) bg-(--card) px-2 py-1 text-[12.5px] text-(--ink) outline-none focus:border-(--accent-text)"
            />
          </form>
        ) : (
          <span className="cursor-pointer" onClick={() => setEditingDueDate(true)}>
            <Chip>{project.dueLabel ?? "Set due date"}</Chip>
          </span>
        )}
        {project.durationLabel && <Chip>◷ {project.durationLabel}</Chip>}
      </div>

      <div className="my-2.5 mb-4 h-1 overflow-hidden rounded-full bg-(--border-soft)">
        <div className="h-full rounded-full bg-(--accent)" style={{ width: `${project.progressPct}%` }} />
      </div>
      <div className="flex flex-col gap-3">
        {visibleSections.map((section) => (
          <div key={section.name ?? "__none__"}>
            {section.name && (
              <div className={`${labelClass} mb-1 mt-1`}>{section.name}</div>
            )}
            <div className="flex flex-col gap-3">
              {section.tasks.map((item) => (
                <TaskRow
                  key={item.id}
                  task={item}
                  categoryOptions={categoryOptions}
                  projectOptions={projectOptions}
                  onCompleting={hold}
                  reorderIds={section.tasks.map((t) => t.id)}
                  sectionOptions={project.sectionsEnabled ? project.sectionNames : undefined}
                />
              ))}
            </div>
          </div>
        ))}
        {viewMode === "none" && project.total > 0 && (
          <div className="pl-8 text-[13px] italic text-(--ink-soft)">{project.total} tasks hidden</div>
        )}
        {viewMode === "unchecked" && visibleCount === 0 && project.total > 0 && (
          <div className="pl-8 text-[13px] italic text-(--ink-soft)">All tasks complete</div>
        )}
        {addingTask ? (
          <form
            ref={addTaskFormRef}
            onSubmit={(e) => {
              e.preventDefault();
              const input = parseTaskForm(new FormData(e.currentTarget));
              if (input.title && input.category) actions.addTask(input);
              setAddingTask(false);
            }}
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="category" value={categoryOptions[0]?.name ?? ""} />
            <input type="hidden" name="dueDate" value={newTaskDueDate} />
            <input type="hidden" name="dueTime" value={newTaskDueTime} />
            <div className="flex items-center gap-2">
              <input
                name="title"
                required
                autoFocus
                placeholder="Task name"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddingTask(false);
                }}
                className="min-w-0 flex-1 border-b border-(--accent-text) bg-transparent text-[15px] text-(--ink) outline-none"
              />
              <button
                type="button"
                onClick={() => setNewTaskDueOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") (newTaskDueOpen ? setNewTaskDueOpen(false) : setAddingTask(false));
                }}
                className="flex-none cursor-pointer rounded-md border border-(--border-strong) bg-(--card) px-1.5 py-0.5 text-[12px] text-(--ink-muted) outline-none"
              >
                {formatPickerLabel(newTaskDueDate, newTaskDueTime)}
              </button>
            </div>
            {newTaskDueOpen && (
              <div ref={newTaskDuePanelRef} className="w-fit rounded-lg border border-(--accent-text) bg-(--card) p-2.5">
                <DateTimePickerPanel
                  dateValue={newTaskDueDate}
                  timeValue={newTaskDueTime}
                  onChangeDate={setNewTaskDueDate}
                  onChangeTime={setNewTaskDueTime}
                />
                <button
                  type="button"
                  onClick={() => {
                    setNewTaskDueDate("");
                    setNewTaskDueTime("");
                  }}
                  className="mt-2 cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                >
                  Clear
                </button>
              </div>
            )}
          </form>
        ) : (
          <div
            className={`${labelClass} cursor-pointer`}
            onClick={() => {
              setNewTaskDueDate(todayInputValue());
              setNewTaskDueTime("");
              setNewTaskDueOpen(false);
              setAddingTask(true);
            }}
          >
            + Add task
          </div>
        )}
      </div>
    </div>
  );
}
