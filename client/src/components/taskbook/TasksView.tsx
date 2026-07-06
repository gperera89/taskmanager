"use client";

import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { useTaskbook } from "./store";
import type { TaskRepeatInput } from "./store";
import { AutoGrowTextarea, CheckSquare, RowDeleteButton, StrikeSweep, labelClass, useCompletionHold } from "./shared";
import { DateTimePickerPanel } from "./DateTimePicker";
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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const { isHeld, hold } = useCompletionHold();
  const q = query.trim().toLowerCase();

  const matchesQuery = (t: TaskItemVM) => !q || t.title.toLowerCase().includes(q);
  const filtered = groups
    .map((g) => ({ ...g, tasks: g.tasks.filter((t) => matchesQuery(t) && (!t.isCompleted || isHeld(t.id))) }))
    .filter((g) => g.tasks.length > 0);
  const completedTasks = groups.flatMap((g) => g.tasks.filter((t) => matchesQuery(t) && t.isCompleted && !isHeld(t.id)));

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
        {filtered.map((group) => {
          const isExpanded = q.length > 0 || (expandedGroups[group.key] ?? false);
          const visibleTasks = isExpanded ? group.tasks : group.tasks.slice(0, GROUP_PREVIEW_COUNT);
          const hiddenCount = group.tasks.length - visibleTasks.length;
          return (
            <div key={group.key}>
              <div
                className={labelClass}
                style={{ margin: "20px 0 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span>{group.label}</span>
                {!q && group.tasks.length > GROUP_PREVIEW_COUNT && (
                  <button
                    type="button"
                    onClick={() => setExpandedGroups((prev) => ({ ...prev, [group.key]: !isExpanded }))}
                    className="cursor-pointer normal-case tracking-normal text-[#8a8069] underline decoration-dotted underline-offset-2"
                  >
                    {isExpanded ? "Show less" : `+${hiddenCount} more`}
                  </button>
                )}
              </div>
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} categoryOptions={categoryOptions} projectOptions={projectOptions} onCompleting={hold} />
              ))}
            </div>
          );
        })}

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
                viewBox="0 -960 960 960"
                style={{ transform: showCompleted ? "rotate(90deg)" : "none", transition: "transform .15s" }}
              >
                <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" fill="#a49a82" />
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

const GROUP_PREVIEW_COUNT = 4;

const chipSelectClass =
  "cursor-pointer whitespace-nowrap rounded-full border-none px-2.5 py-0.5 text-[11.5px] outline-none";

// The two chip <select>s below reuse chipSelectClass but also need the OS-native dropdown
// caret replaced — by default it renders flush against the pill's right edge with a lot of
// dead space before it. This swaps in a small Material "arrow_drop_down" glyph pulled in
// closer to the label instead, colored to match each select's text.
function chipSelectArrowStyle(color: string): React.CSSProperties {
  const fill = encodeURIComponent(color);
  return {
    appearance: "none",
    WebkitAppearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M480-360 240-600h480L480-360Z' fill='${fill}'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 4px center",
    backgroundSize: "13px 13px",
    paddingRight: 20,
  };
}

export function TaskRow({
  task,
  categoryOptions,
  projectOptions,
  onCompleting,
}: {
  task: TaskItemVM;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
  onCompleting?: (id: string) => void;
}) {
  const { actions } = useTaskbook();
  const hasSubtasks = task.subtasksTotal > 0;
  const progressPct = hasSubtasks ? Math.round((task.subtasksDone / task.subtasksTotal) * 100) : 0;

  const [completing, setCompleting] = useState(false);
  function handleToggle() {
    if (task.isCompleted) {
      actions.toggleTask(task.id, task.isCompleted);
      return;
    }
    onCompleting?.(task.id);
    setCompleting(true);
    actions.toggleTask(task.id, task.isCompleted);
    window.setTimeout(() => setCompleting(false), 460);
  }

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? "");
  const [dueOpen, setDueOpen] = useState(false);
  const [dueDateDraft, setDueDateDraft] = useState(task.dueDateValue);
  const [dueTimeDraft, setDueTimeDraft] = useState(task.dueTimeValue);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const repeatChangedRef = useRef(false);
  const repeatDraftRef = useRef<TaskRepeatInput>(null);

  function commitTitle() {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(task.title);
      return;
    }
    if (trimmed === task.title) return;
    actions.renameTask(task.id, trimmed);
  }

  function commitDescription() {
    setEditingDescription(false);
    if (descriptionDraft === (task.description ?? "")) return;
    actions.setTaskDescription(task.id, descriptionDraft);
  }

  function commitCategory(name: string) {
    actions.setTaskCategory(task.id, name);
  }

  function commitProject(projectId: string) {
    actions.setTaskProject(task.id, projectId);
  }

  function openDue() {
    setDueDateDraft(task.dueDateValue);
    setDueTimeDraft(task.dueTimeValue);
    setDueOpen(true);
  }

  function updateDueDraft(nextDate: string, nextTime: string) {
    setDueDateDraft(nextDate);
    setDueTimeDraft(nextTime);
  }

  // Clicking a day/time button doesn't reliably move keyboard focus (macOS Safari never
  // focuses a <button> on click), so an onBlur-based "commit when focus leaves" approach
  // misses plain clicks-away entirely. Watching for a pointerdown outside the panel works
  // regardless of focus behavior.
  const duePanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dueOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (duePanelRef.current?.contains(e.target as Node)) return;
      setDueOpen(false);
      if (dueDateDraft !== task.dueDateValue || dueTimeDraft !== task.dueTimeValue) {
        actions.setTaskDue(task.id, dueDateDraft, dueTimeDraft);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [dueOpen, dueDateDraft, dueTimeDraft, task.id, task.dueDateValue, task.dueTimeValue, actions]);

  function clearDue() {
    setDueDateDraft("");
    setDueTimeDraft("");
    actions.setTaskDue(task.id, "", "");
    setDueOpen(false);
  }

  function openRepeat() {
    repeatChangedRef.current = false;
    setRepeatOpen(true);
  }

  function commitRepeatBlur(e: FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setRepeatOpen(false);
    if (repeatChangedRef.current) actions.setTaskRepeat(task.id, repeatDraftRef.current);
  }

  return (
    <div className="group flex items-start gap-3.5 border-b border-[#e1d8c4] py-3.5 px-0.5">
      <CheckSquare action={handleToggle} checked={task.isCompleted} completing={completing} />
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
            className="w-full rounded border border-[#17399b] bg-[#faf7ef] px-1.5 py-0.5 text-[17px] text-[#2a2622] outline-none"
          />
        ) : (
          <div
            className="relative cursor-text text-[17px] leading-5.5"
            style={{
              color: task.isCompleted ? "#a49a82" : "#2a2622",
              textDecoration: task.isCompleted && !completing ? "line-through" : "none",
            }}
            onClick={() => setEditingTitle(true)}
          >
            {task.title}
            {completing && <StrikeSweep />}
          </div>
        )}

        {editingDescription ? (
          <AutoGrowTextarea
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
            className="mt-1 w-full rounded border border-[#17399b] bg-[#faf7ef] px-1.5 py-1 text-[13.5px] text-[#2a2622] outline-none"
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
            style={{ color: "#557694", background: "rgba(85,118,148,.1)", ...chipSelectArrowStyle("#557694") }}
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
            style={{ color: "#8a8069", background: "rgba(138,128,105,.13)", ...chipSelectArrowStyle("#8a8069") }}
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
            onClick={() => (repeatOpen ? setRepeatOpen(false) : openRepeat())}
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
            onClick={() => (dueOpen ? setDueOpen(false) : openDue())}
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
          <div ref={duePanelRef} className="mt-2 w-fit rounded-lg border border-[#17399b] bg-[#faf7ef] p-2.5">
            <DateTimePickerPanel
              dateValue={dueDateDraft}
              timeValue={dueTimeDraft}
              onChangeDate={(d) => updateDueDraft(d, dueTimeDraft)}
              onChangeTime={(t) => updateDueDraft(dueDateDraft, t)}
            />
            {task.dueDateValue && (
              <button
                type="button"
                onClick={clearDue}
                className="mt-2 cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040]"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {repeatOpen && (
          <div className="mt-2 rounded-lg border border-[#17399b] bg-[#faf7ef] p-3" onBlur={commitRepeatBlur}>
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
              onChange={(rule) => {
                repeatChangedRef.current = true;
                repeatDraftRef.current = rule.frequency
                  ? {
                      frequency: rule.frequency,
                      interval: rule.interval,
                      daysOfWeek: rule.daysOfWeek,
                      monthlyMode: rule.monthlyMode,
                      dayOfMonth: rule.dayOfMonth,
                      monthlyOrdinal: rule.monthlyOrdinal,
                      monthlyWeekday: rule.monthlyWeekday,
                    }
                  : null;
              }}
            />
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
      <div className="flex flex-none items-start pt-0.5">
        <RowDeleteButton action={() => actions.removeTask(task.id)} />
      </div>
    </div>
  );
}
