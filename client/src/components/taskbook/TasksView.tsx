"use client";

import { useEffect, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { DURATION_OPTIONS, REMINDER_LEAD_OPTIONS, parseDurationInput } from "@/lib/shared";
import { useTaskbook } from "./store";
import type { TaskRepeatInput } from "./store";
import {
  AutoGrowTextarea,
  CheckSquare,
  RowDeleteButton,
  SELECT_CARET_INFO,
  SELECT_CARET_MUTED,
  selectCaretStyle,
  StrikeSweep,
  labelClass,
  useCompletionHold,
} from "./shared";
import { DateTimePickerPanel } from "./DateTimePicker";
import QuickAdd from "./QuickAdd";
import RepeatFields from "./RepeatFields";
import type { CategoryOption, ProjectOption, TaskGroupVM, TaskItemVM } from "./types";

// Drag-to-reorder passes the dragged task id between rows of the same group via this shared
// ref (dataTransfer is unreadable during dragover). Module-level is fine: one drag at a time.
let draggingTaskId: string | null = null;

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
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Tasks</div>
        <div className="pb-2.5 text-[13px] text-(--ink-muted)">{remainingToday} remaining today</div>
      </div>
      <div className="my-5 mt-5 mb-1 h-px max-w-[680px] bg-(--rule)" />

      <QuickAdd />

      <div className="max-w-[680px]">
        {filtered.length === 0 && completedTasks.length === 0 && (
          <p className="py-8 text-[15px] italic text-(--ink-soft)">
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
                    className="cursor-pointer normal-case tracking-normal text-(--ink-muted) underline decoration-dotted underline-offset-2"
                  >
                    {isExpanded ? "Show less" : `+${hiddenCount} more`}
                  </button>
                )}
              </div>
              {visibleTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  categoryOptions={categoryOptions}
                  projectOptions={projectOptions}
                  onCompleting={hold}
                  reorderIds={group.tasks.map((t) => t.id)}
                />
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
                <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" style={{ fill: "var(--ink-soft)" }} />
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

// The chip <select>s below reuse chipSelectClass but also need the OS-native dropdown caret
// replaced (see shared.tsx's selectCaretStyle) — by default it renders flush against the
// pill's right edge with a lot of dead space before it.

export function TaskRow({
  task,
  categoryOptions,
  projectOptions,
  onCompleting,
  reorderIds,
  sectionOptions,
}: {
  task: TaskItemVM;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
  onCompleting?: (id: string) => void;
  // Ids of every task in this row's display group, in order — enables drag-to-reorder within
  // the group (a due bucket or a project section). Omitted where reordering has no meaning.
  reorderIds?: string[];
  // Existing section names in the row's project — shows the section picker chip (project cards).
  sectionOptions?: string[];
}) {
  const { actions } = useTaskbook();
  const hasSubtasks = task.subtasksTotal > 0;
  const progressPct = hasSubtasks ? Math.round((task.subtasksDone / task.subtasksTotal) * 100) : 0;
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReasonDraft, setBlockReasonDraft] = useState(task.blockedReason ?? "");
  const [blockUntilDraft, setBlockUntilDraft] = useState(task.blockedUntilValue);
  const [dragOver, setDragOver] = useState(false);

  // Drop the dragged row in front of this one and persist the group's new order.
  function handleDrop() {
    setDragOver(false);
    if (!reorderIds || !draggingTaskId || draggingTaskId === task.id) return;
    const without = reorderIds.filter((id) => id !== draggingTaskId);
    const at = without.indexOf(task.id);
    if (at === -1) return;
    const next = [...without.slice(0, at), draggingTaskId, ...without.slice(at)];
    actions.reorderGroup(next);
  }

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
  const [durationOpen, setDurationOpen] = useState(false);
  const [durationDraft, setDurationDraft] = useState(task.durationLabel ?? "");
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

  function openDuration() {
    setDurationDraft(task.durationLabel ?? "");
    setDurationOpen(true);
  }

  // Same click-away commit as the due panel above — pointerdown outside, not onBlur.
  const durationPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!durationOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (durationPanelRef.current?.contains(e.target as Node)) return;
      setDurationOpen(false);
      const minutes = parseDurationInput(durationDraft);
      if (minutes !== task.durationMinutes) actions.setTaskDuration(task.id, minutes);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [durationOpen, durationDraft, task.id, task.durationMinutes, actions]);

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
    <div
      className="group flex items-start gap-3.5 border-b py-3.5 px-0.5"
      style={{ borderBottomColor: dragOver ? "var(--accent-text)" : "var(--border-soft)", borderBottomWidth: dragOver ? 2 : 1 }}
      draggable={Boolean(reorderIds)}
      onDragStart={(e) => {
        draggingTaskId = task.id;
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        draggingTaskId = null;
        setDragOver(false);
      }}
      onDragOver={(e) => {
        if (!reorderIds || !draggingTaskId || draggingTaskId === task.id) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
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
            className="w-full rounded border border-(--accent-text) bg-(--card) px-1.5 py-0.5 text-[17px] text-(--ink) outline-none"
          />
        ) : (
          <div
            className="relative cursor-text text-[17px] leading-5.5"
            style={{
              color: task.isCompleted ? "var(--ink-soft)" : "var(--ink)",
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
            className="mt-1 w-full rounded border border-(--accent-text) bg-(--card) px-1.5 py-1 text-[13.5px] text-(--ink) outline-none"
          />
        ) : task.description ? (
          <div
            className="mt-0.5 cursor-text text-[13.5px] leading-snug text-(--ink-muted)"
            onClick={() => setEditingDescription(true)}
          >
            {task.description}
          </div>
        ) : (
          <div className="mt-0.5 cursor-text text-[13.5px] italic text-(--ink-ghost)" onClick={() => setEditingDescription(true)}>
            Add description
          </div>
        )}

        {task.blockedLabel && !task.isCompleted && (
          <div className="mt-0.5 text-[12.5px] italic" style={{ color: "var(--danger)" }}>
            {task.blockedLabel}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select
            value={task.category}
            onChange={(e) => commitCategory(e.target.value)}
            className={chipSelectClass}
            style={{ color: "var(--info)", background: "var(--info-wash)", ...selectCaretStyle(SELECT_CARET_INFO) }}
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
            style={{ color: "var(--ink-muted)", background: "var(--muted-wash)", ...selectCaretStyle(SELECT_CARET_MUTED) }}
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
              color: task.repeatLabel ? "var(--info)" : "var(--ink-faint)",
              background: task.repeatLabel ? "var(--info-wash)" : "transparent",
              border: task.repeatLabel ? "none" : "1px dashed var(--border-strong)",
            }}
          >
            {task.repeatLabel ? `↻ ${task.repeatLabel}` : "Repeat"}
          </button>

          <button
            type="button"
            onClick={() => (dueOpen ? setDueOpen(false) : openDue())}
            className={chipSelectClass}
            style={{
              color: task.dueLabel ? "var(--info)" : "var(--ink-faint)",
              background: task.dueLabel ? "var(--info-wash)" : "transparent",
              border: task.dueLabel ? "none" : "1px dashed var(--border-strong)",
            }}
          >
            {task.dueLabel ?? "Set date"}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => (durationOpen ? setDurationOpen(false) : openDuration())}
              className={chipSelectClass}
              style={{
                color: task.durationLabel ? "var(--info)" : "var(--ink-faint)",
                background: task.durationLabel ? "var(--info-wash)" : "transparent",
                border: task.durationLabel ? "none" : "1px dashed var(--border-strong)",
              }}
            >
              {task.durationLabel ? `◷ ${task.durationLabel}` : "Duration"}
            </button>
            {durationOpen && (
              <div
                ref={durationPanelRef}
                className="absolute left-0 top-7 z-20 w-52 rounded-lg border border-(--accent-text) bg-(--card) p-2.5 shadow-[0_8px_24px_rgba(70,55,30,.18)]"
              >
                <input
                  autoFocus
                  value={durationDraft}
                  onChange={(e) => setDurationDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const minutes = parseDurationInput(durationDraft);
                      if (minutes !== task.durationMinutes) actions.setTaskDuration(task.id, minutes);
                      setDurationOpen(false);
                    } else if (e.key === "Escape") {
                      setDurationDraft(task.durationLabel ?? "");
                      setDurationOpen(false);
                    }
                  }}
                  placeholder="e.g. 30 min, 1.5 hours"
                  autoComplete="off"
                  className="w-full rounded-md border border-(--border-strong) bg-(--card) px-2 py-1 text-xs text-(--ink) outline-none focus:border-(--accent-text)"
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {DURATION_OPTIONS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => {
                        const minutes = parseDurationInput(o);
                        setDurationDraft(o);
                        if (minutes !== task.durationMinutes) actions.setTaskDuration(task.id, minutes);
                        setDurationOpen(false);
                      }}
                      className="cursor-pointer rounded-full border border-(--border-strong) px-2 py-0.5 text-[11px] text-(--ink-muted) hover:bg-[rgba(85,118,148,.08)]"
                    >
                      {o}
                    </button>
                  ))}
                </div>
                {task.durationLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      setDurationDraft("");
                      actions.setTaskDuration(task.id, null);
                      setDurationOpen(false);
                    }}
                    className="mt-1.5 cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {/* On-hold ("waiting on") only applies to tasks inside a project — standalone tasks
              just move their due date instead. */}
          {!task.isCompleted && task.projectId && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setBlockReasonDraft(task.blockedReason ?? "");
                  setBlockUntilDraft(task.blockedUntilValue);
                  setBlockOpen((v) => !v);
                }}
                aria-label={task.blockedReason ? "Edit block" : "Mark as blocked"}
                title={task.blockedLabel ?? "On hold until something resolves"}
                className={chipSelectClass}
                style={{
                  color: task.blockedReason ? "var(--danger)" : "var(--ink-faint)",
                  background: task.blockedReason ? "var(--danger-surface)" : "transparent",
                  border: task.blockedReason ? "1px solid var(--danger)" : "1px dashed var(--border-strong)",
                }}
              >
                {/* Material Symbols "block" — same glyph as public/block_24dp_*.svg, inlined so it themes */}
                <svg width="13" height="13" viewBox="0 -960 960 960" aria-hidden>
                  <path
                    d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM480-160q54 0 104-17.5t92-50.5L228-676q-33 42-50.5 92T160-480q0 134 93 227t227 93Zm252-124q33-42 50.5-92T800-480q0-134-93-227t-227-93q-54 0-104 17.5T284-732l448 448ZM480-480Z"
                    style={{ fill: "currentColor" }}
                  />
                </svg>
              </button>
              {blockOpen && (
                <div className="absolute left-0 top-7 z-20 w-60 rounded-lg border border-(--border-strong) bg-(--card) p-2.5 shadow-[0_8px_24px_rgba(70,55,30,.18)]">
                  <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-(--ink-muted)">Waiting on</div>
                  <textarea
                    value={blockReasonDraft}
                    onChange={(e) => setBlockReasonDraft(e.target.value)}
                    placeholder="e.g. reply from parents, budget approval…"
                    rows={2}
                    className="w-full resize-none rounded-md border border-(--border-strong) bg-(--card) px-2 py-1 text-xs text-(--ink) outline-none focus:border-(--accent-text)"
                  />
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[11px] text-(--ink-muted)">Expected to clear</span>
                    <input
                      type="date"
                      value={blockUntilDraft}
                      onChange={(e) => setBlockUntilDraft(e.target.value)}
                      className="rounded-md border border-(--border-strong) bg-transparent px-1.5 py-0.5 text-xs text-(--ink)"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        actions.setTaskBlock(task.id, blockReasonDraft, blockUntilDraft);
                        setBlockOpen(false);
                      }}
                      disabled={!blockReasonDraft.trim()}
                      className="cursor-pointer rounded-md bg-(--accent) px-2.5 py-1 text-xs text-(--on-accent) disabled:opacity-50"
                    >
                      Save
                    </button>
                    {task.blockedReason && (
                      <button
                        type="button"
                        onClick={() => {
                          actions.setTaskBlock(task.id, "", "");
                          setBlockOpen(false);
                        }}
                        className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                      >
                        Unblock
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {sectionOptions && (
            <select
              value={task.section ?? ""}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  const name = window.prompt("New section name");
                  if (name?.trim()) actions.setTaskSection(task.id, name.trim());
                } else {
                  actions.setTaskSection(task.id, e.target.value);
                }
              }}
              aria-label="Section"
              className={chipSelectClass}
              style={{ color: "var(--ink-muted)", background: "var(--muted-wash)", ...selectCaretStyle(SELECT_CARET_MUTED) }}
            >
              <option value="">No section</option>
              {sectionOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__new__">New section…</option>
            </select>
          )}
        </div>

        {dueOpen && (
          <div ref={duePanelRef} className="mt-2 w-fit rounded-lg border border-(--accent-text) bg-(--card) p-2.5">
            <DateTimePickerPanel
              dateValue={dueDateDraft}
              timeValue={dueTimeDraft}
              onChangeDate={(d) => updateDueDraft(d, dueTimeDraft)}
              onChangeTime={(t) => updateDueDraft(dueDateDraft, t)}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <select
                value={task.reminderLeadMinutes ?? ""}
                onChange={(e) => actions.setTaskReminderLead(task.id, e.target.value ? Number(e.target.value) : null)}
                aria-label="Remind me"
                className="cursor-pointer rounded-md border border-(--border-strong) bg-transparent px-1.5 py-0.5 text-xs text-(--info) outline-none"
                style={selectCaretStyle(SELECT_CARET_INFO)}
              >
                {REMINDER_LEAD_OPTIONS.map((o) => (
                  <option key={o.label} value={o.value ?? ""}>
                    Remind: {o.label}
                  </option>
                ))}
              </select>
              {task.dueDateValue && (
                <button
                  type="button"
                  onClick={clearDue}
                  className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger)"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {repeatOpen && (
          <div className="mt-2 rounded-lg border border-(--accent-text) bg-(--card) p-3" onBlur={commitRepeatBlur}>
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

        <div className="mt-2 flex items-center gap-2">
          {hasSubtasks && (
            <>
              <button
                type="button"
                onClick={() => setSubtasksOpen((v) => !v)}
                aria-expanded={subtasksOpen}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-(--info)"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 -960 960 960"
                  style={{ transform: subtasksOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}
                >
                  <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" style={{ fill: "var(--info)" }} />
                </svg>
                {task.subtasksDone} of {task.subtasksTotal} subtasks
              </button>
              <span className="relative inline-block h-[3px] w-[100px] overflow-hidden rounded-full bg-(--border-soft)">
                <span className="absolute inset-y-0 left-0 rounded-full bg-(--info)" style={{ width: `${progressPct}%` }} />
              </span>
            </>
          )}
          {!hasSubtasks && !task.isCompleted && (
            <button
              type="button"
              onClick={() => {
                setSubtasksOpen(true);
                setAddingSubtask(true);
              }}
              className="cursor-pointer text-xs text-(--ink-faint) opacity-0 transition-opacity hover:text-(--info) group-hover:opacity-100"
            >
              + Subtask
            </button>
          )}
        </div>

        {subtasksOpen && (
          <ul className="mt-1.5 flex flex-col gap-1.5 pl-1">
            {task.subtasks.map((s) => (
              <li key={s.id} className="group/sub flex items-center gap-2">
                <CheckSquare action={() => actions.toggleTask(s.id, s.isCompleted)} checked={s.isCompleted} size={16} />
                <span
                  className="flex-1 text-[13px]"
                  style={{ color: s.isCompleted ? "var(--ink-strike)" : "var(--ink-muted)", textDecoration: s.isCompleted ? "line-through" : "none" }}
                >
                  {s.title}
                </span>
                <button
                  type="button"
                  onClick={() => actions.removeTask(s.id)}
                  aria-label={`Remove subtask ${s.title}`}
                  className="cursor-pointer text-xs text-(--ink-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover/sub:opacity-100"
                >
                  Remove
                </button>
              </li>
            ))}
            <li>
              {addingSubtask ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const title = String(new FormData(e.currentTarget).get("title") ?? "").trim();
                    if (title) {
                      actions.addTask({ title, category: task.category, parentId: task.id });
                      (e.target as HTMLFormElement).reset();
                    } else {
                      setAddingSubtask(false);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    name="title"
                    autoFocus
                    placeholder="Subtask"
                    onBlur={(e) => {
                      if (!e.currentTarget.value.trim()) setAddingSubtask(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setAddingSubtask(false);
                    }}
                    className="rounded-md border border-(--border-strong) bg-(--card) px-2 py-0.5 text-[13px] text-(--ink) outline-none focus:border-(--accent-text)"
                  />
                </form>
              ) : (
                <button type="button" onClick={() => setAddingSubtask(true)} className="cursor-pointer text-xs text-(--info)">
                  + Add subtask
                </button>
              )}
            </li>
          </ul>
        )}
      </div>
      <div className="flex flex-none items-start pt-0.5">
        <RowDeleteButton action={() => actions.removeTask(task.id)} />
      </div>
    </div>
  );
}
