"use client";

import { useTaskbook } from "./store";
import { CalendarEventMarker, CalendarTaskItem, FitText, labelClass } from "./shared";
import type { DayDetailVM } from "./types";

export default function DayView({ detail }: { detail: DayDetailVM }) {
  const { actions } = useTaskbook();
  const isEmpty = detail.tasks.length === 0 && detail.projects.length === 0 && detail.events.length === 0;

  return (
    <div>
      <div className="flex max-w-[680px] items-end justify-between gap-3 pb-2">
        <FitText maxFontSize={60} minFontSize={30} className="font-script leading-[1.3] text-(--ink)">
          {detail.fullLabel}
        </FitText>
        {detail.dismissedEvents.length > 0 && (
          <button
            type="button"
            onClick={() => detail.dismissedEvents.forEach((d) => actions.restoreEvent(d.id))}
            className="flex-none cursor-pointer whitespace-nowrap pb-2 text-[13px] text-(--info) underline decoration-dotted underline-offset-2"
          >
            {detail.dismissedEvents.length} dismissed · Restore
          </button>
        )}
      </div>
      <div className="my-5 mb-1 h-px max-w-[680px] bg-(--rule)" />

      <div className="max-w-[680px]">
        {detail.tasks.length > 0 && (
          <>
            <div className={labelClass} style={{ margin: "22px 0 4px" }}>
              Tasks due
            </div>
            {detail.tasks.map((t) => (
              <div key={t.id} className="flex gap-3.5 border-b border-(--border-soft) py-3.5">
                <CalendarTaskItem
                  title={t.title}
                  isCompleted={t.isCompleted}
                  onToggle={() => actions.toggleTask(t.id, t.isCompleted)}
                  size={22}
                  textClassName="text-[17px]"
                />
              </div>
            ))}
          </>
        )}

        {detail.projects.length > 0 && (
          <>
            <div className={labelClass} style={{ margin: "24px 0 4px" }}>
              Due from projects
            </div>
            {detail.projects.map((p) => (
              <div key={p.id} className="flex gap-3.5 border-b border-(--border-soft) py-3.5">
                <span className="mt-0.5 h-[22px] w-[22px] flex-none rounded border border-(--ink-faint)" />
                <div className="flex-1">
                  <div className="text-[17px] text-(--ink)">{p.name}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {detail.events.length > 0 && (
          <>
            <div className={labelClass} style={{ margin: "24px 0 4px" }}>
              From your calendars
            </div>
            {detail.events.map((e) => (
              <div key={e.id} className="flex items-center gap-3.5 border-b border-(--border-soft) py-3">
                <CalendarEventMarker source={e.source} title={e.title} onDismiss={() => actions.dismissEvent(e.id)} size={22} />
                <div className="flex-1 text-[17px] text-(--ink)">{e.title}</div>
                <span className="text-[12.5px] italic text-(--ink-soft)">{e.metaLabel}</span>
              </div>
            ))}
          </>
        )}

        {isEmpty && <div className="py-8 text-[15px] italic text-(--ink-soft)">No events or tasks for this day.</div>}
      </div>
    </div>
  );
}
