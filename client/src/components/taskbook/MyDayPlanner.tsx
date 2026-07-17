"use client";

// The My Day timeline planner rendered inside DayView: a 5am–9pm (stretchable) day grid showing
// everything due/scheduled on the selected day (tasks, projects, routines, habits, ICS events)
// plus a "needs a time" tray and a look-ahead list of future tasks that could be done early.
// All mutations go through the optimistic store, so drags/edits/completions re-derive instantly.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiSuggestion, CapturedKind } from "@prisma/client";
import { refreshSuggestions } from "@/app/actions";
import { DURATION_OPTIONS, formatDuration, parseDurationInput } from "@/lib/shared";
import { pad2, zonedMinutesOfDay } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import { CheckSquare, SELECT_CARET_MUTED, selectCaretStyle, labelClass } from "./shared";
import type { CategoryOption, MyDayBlockVM, MyDayKind, MyDayLookaheadVM, MyDayTrayItemVM, MyDayVM } from "./types";

const HOUR_PX = 64;
const SNAP_MINUTES = 15;
const MIN_BLOCK_PX = 26; // short blocks stay clickable

// Drag payload shared between the tray/blocks/look-ahead rows and the timeline's drop handler
// (dataTransfer is unreadable during dragover). Module-level is fine: one drag at a time.
type DragPayload = {
  kind: MyDayKind;
  entityId: string;
  planBlockId: string | null;
  durationMinutes: number | null;
};
let draggingItem: DragPayload | null = null;

const KIND_TO_ENUM: Partial<Record<MyDayKind, CapturedKind>> = {
  task: "TASK",
  project: "PROJECT",
  routine: "ROUTINE",
  habit: "HABIT",
};

const KIND_STYLE: Record<MyDayKind, { bg: string; edge: string }> = {
  task: { bg: "var(--accent-wash)", edge: "var(--accent-text)" },
  project: { bg: "var(--accent-wash)", edge: "var(--accent-text)" },
  event: { bg: "var(--info-wash)", edge: "var(--info)" },
  routine: { bg: "var(--muted-wash)", edge: "var(--ink-muted)" },
  habit: { bg: "var(--info-wash-soft)", edge: "var(--ink-muted)" },
  template: { bg: "transparent", edge: "var(--ink-faint)" },
};

function hhmm(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function formatHourLabel(hour: number): string {
  const h12 = hour % 12 || 12;
  return `${h12} ${hour < 12 ? "AM" : "PM"}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export default function MyDayPlanner({ myDay }: { myDay: MyDayVM }) {
  const { actions, raw, nowMs } = useTaskbook();

  // --- Shared mutation helpers (used by blocks, tray rows and the look-ahead list) ---

  function toggleItem(kind: MyDayKind, entityId: string, isCompleted: boolean) {
    if (kind === "task") actions.toggleTask(entityId, isCompleted);
    else if (kind === "project") actions.toggleProject(entityId, isCompleted);
    else if (kind === "routine") (isCompleted ? actions.untickRoutine : actions.tickRoutine)(entityId);
    else if (kind === "habit") {
      // markHabitDone also writes the Logbook row; retro-toggles (other days / undo) go
      // through the heatmap-style toggle instead.
      if (!isCompleted && myDay.isToday) actions.markHabitDone(entityId);
      else actions.toggleHabitCompletion(entityId, myDay.dateKey);
    }
  }

  // Pin an item at a time on the viewed day. Tasks with their own due time still get a block —
  // the block wins in the deriver, and the task's dueDate stays untouched (its deadline is a
  // separate fact from when it's planned to be worked on).
  function placeAt(payload: DragPayload, minutes: number) {
    const startTime = hhmm(minutes);
    if (payload.planBlockId) {
      actions.updateDayPlanBlock(payload.planBlockId, { startTime });
      return;
    }
    const entityType = KIND_TO_ENUM[payload.kind];
    if (!entityType) return;
    actions.addDayPlanBlock({
      date: myDay.dateKey,
      entityType,
      entityId: payload.entityId,
      startTime,
      durationMinutes: payload.durationMinutes,
    });
  }

  function setItemDuration(item: { kind: MyDayKind; entityId: string; planBlockId: string | null }, minutes: number | null) {
    if (item.planBlockId) {
      actions.updateDayPlanBlock(item.planBlockId, { durationMinutes: minutes });
    } else if (item.kind === "task") {
      actions.setTaskDuration(item.entityId, minutes);
    } else {
      // Routines/habits/projects without a block: a floating block carries the per-day duration.
      const entityType = KIND_TO_ENUM[item.kind];
      if (entityType) actions.addDayPlanBlock({ date: myDay.dateKey, entityType, entityId: item.entityId, durationMinutes: minutes });
    }
  }

  // Push an item to another calendar day. Blocks just move their date; a bare task moves its
  // due date (keeping any due time); a bare project moves its deadline.
  function pushToDate(
    item: { kind: MyDayKind; entityId: string; planBlockId: string | null; timeValue?: string },
    dateKey: string
  ) {
    if (item.planBlockId) actions.updateDayPlanBlock(item.planBlockId, { date: dateKey });
    else if (item.kind === "task") actions.setTaskDue(item.entityId, dateKey, item.timeValue ?? "");
    else if (item.kind === "project") actions.setProjectDueDate(item.entityId, dateKey);
  }

  // "Do today" from the look-ahead: an unpinned block for the viewed day — the task lands in
  // the tray (or gets dragged onto the timeline) while its own due date stays untouched.
  function doToday(taskId: string, durationMinutes: number | null) {
    actions.addDayPlanBlock({ date: myDay.dateKey, entityType: "TASK", entityId: taskId, durationMinutes });
  }

  const helpers: PlannerHelpers = { myDay, toggleItem, placeAt, setItemDuration, pushToDate, doToday };

  const nowMinutes = myDay.isToday ? zonedMinutesOfDay(new Date(nowMs), raw.timeZone) : null;

  return (
    <div className="max-w-[680px]">
      {myDay.allDayEvents.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {myDay.allDayEvents.map((e) => (
            <span
              key={e.id}
              className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px]"
              style={{ background: "var(--info-wash)", color: "var(--ink)" }}
            >
              {e.title}
              <button
                type="button"
                onClick={() => actions.dismissEvent(e.id)}
                aria-label={`Dismiss ${e.title}`}
                className="cursor-pointer text-(--ink-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {myDay.isToday && <Suggestions />}

      {myDay.tray.length > 0 && <Tray items={myDay.tray} helpers={helpers} />}

      <Timeline myDay={myDay} nowMinutes={nowMinutes} helpers={helpers} />

      {myDay.lookahead.length > 0 && <Lookahead items={myDay.lookahead} helpers={helpers} />}
    </div>
  );
}

type PlannerHelpers = {
  myDay: MyDayVM;
  toggleItem: (kind: MyDayKind, entityId: string, isCompleted: boolean) => void;
  placeAt: (payload: DragPayload, minutes: number) => void;
  setItemDuration: (item: { kind: MyDayKind; entityId: string; planBlockId: string | null }, minutes: number | null) => void;
  pushToDate: (item: { kind: MyDayKind; entityId: string; planBlockId: string | null; timeValue?: string }, dateKey: string) => void;
  doToday: (taskId: string, durationMinutes: number | null) => void;
};

// --- AI planner suggestions (today only) ---

function defaultCategory(options: CategoryOption[]): string {
  return (options.find((c) => c.scope === "WORK") ?? options[0])?.name ?? "Work";
}

function Suggestions() {
  const { raw, data, actions } = useTaskbook();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshSuggestions();
      router.refresh(); // pull the fresh rows into the store's next server snapshot
    } catch (err) {
      console.error("refreshSuggestions failed:", err);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between">
        <div className={labelClass}>Suggestions</div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="cursor-pointer text-[12.5px] text-(--info) hover:underline disabled:opacity-50"
        >
          {refreshing ? "Thinking…" : "↻ Refresh"}
        </button>
      </div>

      {raw.suggestions.length === 0 && (
        <div className="py-2 text-[13px] italic text-(--ink-soft)">No suggestions right now.</div>
      )}
      {raw.suggestions.map((s) => (
        <SuggestionCard key={s.id} suggestion={s} category={defaultCategory(data.categoryOptions)} actions={actions} />
      ))}

      {/* Quick note for future generations — full manager lives in Settings */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (noteDraft.trim()) {
            actions.addAiNote(noteDraft);
            setNoteDraft("");
          }
        }}
        className="mt-2 flex items-center gap-2"
      >
        <input
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Note for the AI's future consideration…"
          className="flex-1 rounded-full border border-(--border-faint) bg-transparent px-3 py-1.5 text-[13px] text-(--ink) outline-none placeholder:text-(--ink-ghost)"
        />
        {noteDraft.trim() && (
          <button type="submit" className="cursor-pointer text-[12.5px] text-(--accent-text) hover:underline">
            Save
          </button>
        )}
      </form>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  category,
  actions,
}: {
  suggestion: AiSuggestion;
  category: string;
  actions: ReturnType<typeof useTaskbook>["actions"];
}) {
  const [pickDate, setPickDate] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const suggestedKey = suggestion.suggestedDate ? new Date(suggestion.suggestedDate).toISOString().slice(0, 10) : null;
  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="border-b border-(--border-soft) py-2.5">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] uppercase tracking-wide"
          style={{ color: "var(--info)", background: "var(--info-wash)" }}
        >
          {suggestion.kind}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] text-(--ink)">{suggestion.title}</div>
          <div className="text-[11.5px] text-(--ink-soft)">
            {[suggestion.description, suggestion.eventTitle ? `for “${suggestion.eventTitle}”` : null, suggestedKey ? `suggested ${suggestedKey}` : null]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-3 pl-1 text-[12.5px]">
        <button
          type="button"
          onClick={() => actions.acceptSuggestion(suggestion.id, category, suggestedKey)}
          className="cursor-pointer rounded-full border border-(--border) px-3 py-0.5 text-(--accent-text) hover:bg-(--accent-wash)"
        >
          Add
        </button>
        <div className="relative">
          <button type="button" onClick={() => setPickDate((v) => !v)} className="cursor-pointer text-(--ink-muted) hover:text-(--ink)">
            Add on a day ▾
          </button>
          {pickDate && (
            <input
              type="date"
              min={todayKey}
              onChange={(e) => {
                if (e.target.value) {
                  actions.acceptSuggestion(suggestion.id, category, e.target.value);
                  setPickDate(false);
                }
              }}
              className="absolute left-0 top-full z-30 mt-1 rounded border border-(--border) bg-(--card) px-2 py-1 text-[12.5px] text-(--ink)"
            />
          )}
        </div>
        <div className="relative">
          <button type="button" onClick={() => setSnoozeOpen((v) => !v)} className="cursor-pointer text-(--ink-muted) hover:text-(--ink)">
            Snooze
          </button>
          {snoozeOpen && (
            <div
              className="absolute left-0 top-full z-30 mt-1 w-36 rounded-xl border border-(--border) p-2 shadow-[0_16px_40px_rgba(70,55,30,.22)]"
              style={{ background: "var(--card)" }}
            >
              {[
                { label: "Tomorrow", days: 1 },
                { label: "In 3 days", days: 3 },
                { label: "Next week", days: 7 },
              ].map((o) => (
                <button
                  key={o.days}
                  type="button"
                  onClick={() => {
                    actions.snoozeSuggestion(suggestion.id, addDaysToDateKey(todayKey, o.days));
                    setSnoozeOpen(false);
                  }}
                  className="block w-full cursor-pointer rounded px-2 py-1 text-left text-[13px] text-(--ink) hover:bg-(--muted-wash)"
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => actions.dismissSuggestion(suggestion.id)}
          className="cursor-pointer text-(--ink-faint) hover:text-(--danger)"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// --- Tray: due/scheduled today but not yet on the timeline ---

function Tray({ items, helpers }: { items: MyDayTrayItemVM[]; helpers: PlannerHelpers }) {
  return (
    <div className="mt-5">
      <div className={labelClass} style={{ margin: "0 0 4px" }}>
        Unscheduled
      </div>
      {items.map((item) => (
        <TrayRow key={item.key} item={item} helpers={helpers} />
      ))}
    </div>
  );
}

function TrayRow({ item, helpers }: { item: MyDayTrayItemVM; helpers: PlannerHelpers }) {
  const [placeOpen, setPlaceOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const canPush = item.kind === "task" || item.kind === "project" || item.planBlockId != null;
  const payload: DragPayload = { kind: item.kind, entityId: item.entityId, planBlockId: item.planBlockId, durationMinutes: item.durationMinutes };

  return (
    <div
      className="group flex items-center gap-3 border-b border-(--border-soft) py-2.5"
      draggable
      onDragStart={() => {
        draggingItem = payload;
      }}
      onDragEnd={() => {
        draggingItem = null;
      }}
    >
      <CheckSquare
        action={() => helpers.toggleItem(item.kind, item.entityId, item.isCompleted)}
        checked={item.isCompleted}
        size={20}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-[15px]"
          style={{
            color: item.isCompleted ? "var(--ink-soft)" : "var(--ink)",
            textDecoration: item.isCompleted ? "line-through" : "none",
          }}
        >
          {item.title}
        </div>
        <div
          className="text-[11.5px]"
          style={{ color: item.reason === "no-fit" || item.reason === "blocked" ? "var(--danger)" : "var(--ink-soft)" }}
        >
          {item.reason === "blocked"
            ? `blocked — waiting: ${item.blockedReason}`
            : [
                item.projectName,
                item.kind !== "task" ? item.kind : null,
                item.durationMinutes == null ? "add a duration to schedule it" : formatDuration(item.durationMinutes),
                item.reason === "no-fit" ? "won't fit today — push it?" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </div>
      </div>

      <DurationSelect
        value={item.durationMinutes}
        onChange={(m) => helpers.setItemDuration(item, m)}
      />

      {canPush && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setPushOpen((v) => !v);
              setPlaceOpen(false);
            }}
            title="Push to another day"
            className="cursor-pointer text-[12.5px] text-(--ink-muted) hover:text-(--ink)"
          >
            Push
          </button>
          {pushOpen && (
            <PushMenu
              onPick={(dateKey) => {
                helpers.pushToDate(item, dateKey);
                setPushOpen(false);
              }}
              baseDateKey={helpers.myDay.dateKey}
            />
          )}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setPlaceOpen((v) => !v);
            setPushOpen(false);
          }}
          title="Place on the timeline"
          className="cursor-pointer text-[12.5px] text-(--accent-text) hover:underline"
        >
          Place
        </button>
        {placeOpen && (
          <TimePickPanel
            onPick={(minutes) => {
              helpers.placeAt(payload, minutes);
              setPlaceOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// --- Timeline ---

function Timeline({ myDay, nowMinutes, helpers }: { myDay: MyDayVM; nowMinutes: number | null; helpers: PlannerHelpers }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [ghostMinutes, setGhostMinutes] = useState<number | null>(null);
  const [openBlockKey, setOpenBlockKey] = useState<string | null>(null);

  const startMin = myDay.startHour * 60;
  const totalMinutes = (myDay.endHour - myDay.startHour) * 60;
  const heightPx = (totalMinutes / 60) * HOUR_PX;

  function minutesFromPointer(clientY: number): number {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return startMin;
    const raw = startMin + ((clientY - rect.top) / HOUR_PX) * 60;
    const snapped = Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES;
    return Math.min(Math.max(snapped, 0), 24 * 60 - SNAP_MINUTES);
  }

  const hours: number[] = [];
  for (let h = myDay.startHour; h <= myDay.endHour; h++) hours.push(h);

  return (
    <div className="mt-6 flex">
      {/* Hour gutter */}
      <div className="relative w-14 flex-none" style={{ height: heightPx }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute right-2 -translate-y-1/2 text-[11px] text-(--ink-soft)"
            style={{ top: (h - myDay.startHour) * HOUR_PX }}
          >
            {formatHourLabel(h)}
          </div>
        ))}
      </div>

      {/* Blocks area */}
      <div
        ref={areaRef}
        className="relative flex-1"
        style={{ height: heightPx }}
        onDragOver={(e) => {
          if (!draggingItem) return;
          e.preventDefault();
          setGhostMinutes(minutesFromPointer(e.clientY));
        }}
        onDragLeave={() => setGhostMinutes(null)}
        onDrop={(e) => {
          e.preventDefault();
          setGhostMinutes(null);
          if (!draggingItem) return;
          helpers.placeAt(draggingItem, minutesFromPointer(e.clientY));
          draggingItem = null;
        }}
      >
        {/* Wellbeing template zone bands (behind everything) */}
        {myDay.zones.map((z) => {
          const zTop = ((Math.max(z.startMinutes, startMin) - startMin) / 60) * HOUR_PX;
          const zEnd = Math.min(z.endMinutes, startMin + totalMinutes);
          const zHeight = ((zEnd - Math.max(z.startMinutes, startMin)) / 60) * HOUR_PX;
          if (zHeight <= 0) return null;
          return (
            <div
              key={z.key}
              className="pointer-events-none absolute left-0 right-0"
              style={{ top: zTop, height: zHeight, background: z.key === "work" ? "var(--info-wash-soft)" : "var(--muted-wash)", opacity: 0.4 }}
            >
              <span className="absolute right-1 top-0.5 text-[10px] uppercase tracking-[0.14em] text-(--ink-faint)">
                {z.label}
              </span>
            </div>
          );
        })}

        {hours.map((h) => (
          <div
            key={h}
            className="absolute left-0 right-0 border-t border-(--border-soft)"
            style={{ top: (h - myDay.startHour) * HOUR_PX }}
          />
        ))}

        {ghostMinutes != null && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-dashed"
            style={{ top: ((ghostMinutes - startMin) / 60) * HOUR_PX, borderColor: "var(--accent-text)" }}
          >
            <span className="absolute -top-5 left-0 rounded px-1 text-[11px]" style={{ color: "var(--accent-text)", background: "var(--card)" }}>
              {formatHourLabel(Math.floor(ghostMinutes / 60))} {ghostMinutes % 60 ? `:${pad2(ghostMinutes % 60)}` : ""}
            </span>
          </div>
        )}

        {nowMinutes != null && nowMinutes >= startMin && nowMinutes <= startMin + totalMinutes && (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10"
            style={{ top: ((nowMinutes - startMin) / 60) * HOUR_PX }}
          >
            <div className="h-px w-full" style={{ background: "var(--danger)" }} />
            <div className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full" style={{ background: "var(--danger)" }} />
          </div>
        )}

        {myDay.timeline.map((b) => (
          <TimelineBlock
            key={b.key}
            block={b}
            startMin={startMin}
            isOpen={openBlockKey === b.key}
            onToggleOpen={() => setOpenBlockKey((k) => (k === b.key ? null : b.key))}
            helpers={helpers}
          />
        ))}

        {myDay.timeline.length === 0 && (
          <div className="absolute inset-x-0 top-24 text-center text-[14px] italic text-(--ink-soft)">
            Nothing scheduled — drag items here or use Place.
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineBlock({
  block,
  startMin,
  isOpen,
  onToggleOpen,
  helpers,
}: {
  block: MyDayBlockVM;
  startMin: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  helpers: PlannerHelpers;
}) {
  const { actions } = useTaskbook();
  const style = KIND_STYLE[block.kind];
  const top = ((block.startMinutes - startMin) / 60) * HOUR_PX;
  const height = Math.max((block.durationMinutes / 60) * HOUR_PX, MIN_BLOCK_PX);
  const laneWidth = 100 / block.cols;
  const isEvent = block.kind === "event";
  const isTemplate = block.kind === "template";
  const payload: DragPayload = {
    kind: block.kind,
    entityId: block.entityId,
    planBlockId: block.planBlockId,
    durationMinutes: block.hasExplicitDuration ? block.durationMinutes : null,
  };

  return (
    <div
      className="absolute"
      style={{
        top,
        height,
        left: `calc(${block.col * laneWidth}% + 2px)`,
        width: `calc(${laneWidth}% - 6px)`,
        zIndex: isOpen ? 30 : 1,
      }}
    >
      <div
        draggable={!isEvent && !isTemplate}
        onDragStart={() => {
          draggingItem = payload;
        }}
        onDragEnd={() => {
          draggingItem = null;
        }}
        onClick={isTemplate ? undefined : onToggleOpen}
        className={`flex h-full flex-col overflow-hidden rounded-lg px-2.5 py-1 ${isTemplate ? "" : "cursor-pointer"}`}
        style={{
          background: style.bg,
          borderLeft: isTemplate ? "none" : `3px solid ${style.edge}`,
          border: isTemplate ? "1.5px dashed var(--ink-faint)" : undefined,
          opacity: block.isCompleted ? 0.55 : 1,
        }}
      >
        <div
          className="truncate text-[13.5px] leading-tight"
          style={{
            color: isTemplate ? "var(--ink-muted)" : "var(--ink)",
            fontStyle: isTemplate ? "italic" : "normal",
            textDecoration: block.isCompleted ? "line-through" : "none",
          }}
        >
          {block.title}
        </div>
        {height >= 40 && (
          <div className="truncate text-[11px] text-(--ink-muted)">
            {block.timeLabel}
            {block.source ? ` · ${block.source}` : ""}
            {block.projectName ? ` · ${block.projectName}` : ""}
            {!block.pinned ? " · auto" : ""}
            {!block.hasExplicitDuration && !isEvent ? " · est." : ""}
          </div>
        )}
      </div>

      {isOpen && !isTemplate && (
        <BlockPopover block={block} payload={payload} onClose={onToggleOpen} helpers={helpers} actions={actions} />
      )}
    </div>
  );
}

function BlockPopover({
  block,
  payload,
  onClose,
  helpers,
  actions,
}: {
  block: MyDayBlockVM;
  payload: DragPayload;
  onClose: () => void;
  helpers: PlannerHelpers;
  actions: ReturnType<typeof useTaskbook>["actions"];
}) {
  const isEvent = block.kind === "event";
  const [titleDraft, setTitleDraft] = useState(block.title);
  const [descDraft, setDescDraft] = useState(block.description ?? "");
  const [pushOpen, setPushOpen] = useState(false);
  const timeValue = hhmm(block.startMinutes);
  const canEditText = block.kind === "task";
  const canPush = block.kind === "task" || block.kind === "project" || block.planBlockId != null;

  return (
    <div
      className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-(--border) p-3 shadow-[0_16px_40px_rgba(70,55,30,.22)]"
      style={{ background: "var(--card)" }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2.5">
        {!isEvent && (
          <CheckSquare
            action={() => helpers.toggleItem(block.kind, block.entityId, block.isCompleted)}
            checked={block.isCompleted}
            size={20}
          />
        )}
        <div className="min-w-0 flex-1">
          {canEditText ? (
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                const t = titleDraft.trim();
                if (t && t !== block.title) actions.renameTask(block.entityId, t);
              }}
              className="w-full bg-transparent text-[15px] text-(--ink) outline-none"
            />
          ) : (
            <div className="text-[15px] text-(--ink)">{block.title}</div>
          )}
          <div className="text-[11.5px] text-(--ink-soft)">
            {block.timeLabel}
            {block.source ? ` · ${block.source}` : ""}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer text-[13px] text-(--ink-faint) hover:text-(--ink)">
          ✕
        </button>
      </div>

      {canEditText && (
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          onBlur={() => {
            if (descDraft.trim() !== (block.description ?? "")) actions.setTaskDescription(block.entityId, descDraft.trim());
          }}
          placeholder="Add description"
          rows={2}
          className="mt-2 w-full resize-none rounded border border-(--border-faint) bg-transparent p-1.5 text-[13px] text-(--ink) outline-none placeholder:text-(--ink-ghost)"
        />
      )}

      {!isEvent && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
          {/* Move to another time on this day */}
          <input
            type="time"
            defaultValue={timeValue}
            onChange={(e) => {
              const m = /^(\d{2}):(\d{2})$/.exec(e.target.value);
              if (m) helpers.placeAt(payload, Number(m[1]) * 60 + Number(m[2]));
            }}
            className="rounded border border-(--border-faint) bg-transparent px-1.5 py-0.5 text-[12.5px] text-(--ink)"
          />
          <DurationSelect
            value={block.hasExplicitDuration ? block.durationMinutes : null}
            onChange={(m) => helpers.setItemDuration(block, m)}
          />
          {canPush && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPushOpen((v) => !v)}
                className="cursor-pointer text-[12.5px] text-(--ink-muted) hover:text-(--ink)"
              >
                Push →
              </button>
              {pushOpen && (
                <PushMenu
                  baseDateKey={helpers.myDay.dateKey}
                  onPick={(dateKey) => {
                    helpers.pushToDate({ ...payload, timeValue }, dateKey);
                    setPushOpen(false);
                    onClose();
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-3 border-t border-(--border-faint) pt-2">
        {block.planBlockId ? (
          <>
            <button
              type="button"
              onClick={() => {
                actions.updateDayPlanBlock(block.planBlockId!, { startTime: null });
                onClose();
              }}
              className="cursor-pointer text-[12px] text-(--ink-muted) hover:text-(--ink)"
              title="Back to the tray — no fixed time"
            >
              Unpin
            </button>
            <button
              type="button"
              onClick={() => {
                actions.removeDayPlanBlock(block.planBlockId!);
                onClose();
              }}
              className="cursor-pointer text-[12px] text-(--ink-faint) hover:text-(--danger)"
            >
              Remove from day
            </button>
          </>
        ) : block.kind === "task" ? (
          <button
            type="button"
            onClick={() => {
              // A task pinned by its own due time: clearing the time keeps the date.
              actions.setTaskDue(block.entityId, helpers.myDay.dateKey, "");
              onClose();
            }}
            className="cursor-pointer text-[12px] text-(--ink-muted) hover:text-(--ink)"
          >
            Clear time
          </button>
        ) : null}
        {isEvent && (
          <button
            type="button"
            onClick={() => {
              actions.dismissEvent(block.entityId);
              onClose();
            }}
            className="cursor-pointer text-[12px] text-(--ink-faint) hover:text-(--danger)"
          >
            Dismiss event
          </button>
        )}
      </div>
    </div>
  );
}

// --- Look-ahead: future tasks that could be done early ---

function Lookahead({ items, helpers }: { items: MyDayLookaheadVM[]; helpers: PlannerHelpers }) {
  return (
    <div className="mt-7">
      <div className={labelClass} style={{ margin: "0 0 4px" }}>
        Could be done early
      </div>
      {items.map((t) => (
        <div
          key={t.taskId}
          className="flex items-center gap-3 border-b border-(--border-soft) py-2.5"
          draggable
          onDragStart={() => {
            draggingItem = { kind: "task", entityId: t.taskId, planBlockId: null, durationMinutes: t.durationMinutes };
          }}
          onDragEnd={() => {
            draggingItem = null;
          }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px] text-(--ink)">{t.title}</div>
            <div className="text-[11.5px] text-(--ink-soft)">
              {[`due ${t.dueLabel}`, t.projectName, t.durationMinutes != null ? formatDuration(t.durationMinutes) : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => helpers.doToday(t.taskId, t.durationMinutes)}
            className="cursor-pointer rounded-full border border-(--border) px-3 py-1 text-[12.5px] text-(--accent-text) hover:bg-(--accent-wash)"
          >
            Do today
          </button>
        </div>
      ))}
    </div>
  );
}

// --- Small shared controls ---

function DurationSelect({ value, onChange }: { value: number | null; onChange: (minutes: number | null) => void }) {
  return (
    <select
      value={value != null ? formatDuration(value) : ""}
      onChange={(e) => onChange(e.target.value ? parseDurationInput(e.target.value) : null)}
      className="cursor-pointer rounded border border-(--border-faint) bg-transparent px-1 py-0.5 text-[12px] text-(--ink-muted)"
      style={selectCaretStyle(SELECT_CARET_MUTED)}
      title="Duration"
    >
      <option value="">duration</option>
      {DURATION_OPTIONS.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
      {value != null && !DURATION_OPTIONS.some((d) => parseDurationInput(d) === value) && (
        <option value={formatDuration(value)}>{formatDuration(value)}</option>
      )}
    </select>
  );
}

function PushMenu({ baseDateKey, onPick }: { baseDateKey: string; onPick: (dateKey: string) => void }) {
  return (
    <div
      className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-(--border) p-2 shadow-[0_16px_40px_rgba(70,55,30,.22)]"
      style={{ background: "var(--card)" }}
    >
      {[
        { label: "Tomorrow", days: 1 },
        { label: "In 2 days", days: 2 },
        { label: "Next week", days: 7 },
      ].map((o) => (
        <button
          key={o.days}
          type="button"
          onClick={() => onPick(addDaysToDateKey(baseDateKey, o.days))}
          className="block w-full cursor-pointer rounded px-2 py-1 text-left text-[13px] text-(--ink) hover:bg-(--muted-wash)"
        >
          {o.label}
        </button>
      ))}
      <input
        type="date"
        min={baseDateKey}
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
        }}
        className="mt-1 w-full rounded border border-(--border-faint) bg-transparent px-2 py-1 text-[12.5px] text-(--ink)"
      />
    </div>
  );
}

function TimePickPanel({ onPick }: { onPick: (minutes: number) => void }) {
  const [value, setValue] = useState("09:00");
  return (
    <div
      className="absolute right-0 top-full z-40 mt-1 flex w-44 items-center gap-2 rounded-xl border border-(--border) p-2 shadow-[0_16px_40px_rgba(70,55,30,.22)]"
      style={{ background: "var(--card)" }}
    >
      <input
        type="time"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 rounded border border-(--border-faint) bg-transparent px-1.5 py-1 text-[12.5px] text-(--ink)"
      />
      <button
        type="button"
        onClick={() => {
          const m = /^(\d{2}):(\d{2})$/.exec(value);
          if (m) onPick(Number(m[1]) * 60 + Number(m[2]));
        }}
        className="cursor-pointer text-[12.5px] text-(--accent-text) hover:underline"
      >
        Set
      </button>
    </div>
  );
}
