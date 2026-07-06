"use client";

import { useTaskbook } from "./store";
import { Chip, FitText, labelClass } from "./shared";
import type { DayDetailVM } from "./types";

export default function DayView({ detail }: { detail: DayDetailVM }) {
  const { actions } = useTaskbook();
  const isEmpty = detail.tasks.length === 0 && detail.projects.length === 0 && detail.events.length === 0;

  return (
    <div>
      <div className="max-w-[680px] pb-2">
        <FitText maxFontSize={60} minFontSize={30} className="font-script leading-[1.3] text-[#2a2622]">
          {detail.fullLabel}
        </FitText>
      </div>
      <div className="my-5 mb-1 h-px max-w-[680px] bg-[#d5cbb4]" />

      <div className="max-w-[680px]">
        {detail.tasks.length > 0 && (
          <>
            <div className={labelClass} style={{ margin: "22px 0 4px" }}>
              Tasks due
            </div>
            {detail.tasks.map((t) => (
              <div key={t.id} className="flex gap-3.5 border-b border-[#e1d8c4] py-3.5">
                <button
                  type="button"
                  onClick={() => actions.toggleTask(t.id, t.isCompleted)}
                  className="mt-0.5 flex h-[22px] w-[22px] flex-none cursor-pointer items-center justify-center rounded"
                  style={{
                    border: `1.5px solid ${t.isCompleted ? "#17399b" : "#b3a988"}`,
                    background: t.isCompleted ? "rgba(23,57,155,.06)" : "transparent",
                  }}
                >
                  {t.isCompleted && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M4 13.5 L9.5 18.5 L20 5.5" stroke="#17399b" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div className="flex-1">
                  <div
                    className="text-[17px]"
                    style={{ color: t.isCompleted ? "#a49a82" : "#2a2622", textDecoration: t.isCompleted ? "line-through" : "none" }}
                  >
                    {t.title}
                  </div>
                  {t.projectName && (
                    <div className="mt-1.5">
                      <Chip variant="project">{t.projectName}</Chip>
                    </div>
                  )}
                </div>
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
              <div key={p.id} className="flex gap-3.5 border-b border-[#e1d8c4] py-3.5">
                <span className="mt-0.5 h-[22px] w-[22px] flex-none rounded border border-[#b3a988]" />
                <div className="flex-1">
                  <div className="text-[17px] text-[#2a2622]">{p.name}</div>
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
              <div key={e.id} className="flex items-center gap-3.5 border-b border-[#e1d8c4] py-3">
                <span className="ml-1.5 h-2 w-2 flex-none rounded-full bg-[#557694]" />
                <div className="flex-1 text-[17px] text-[#2a2622]">{e.title}</div>
                <span className="text-[12.5px] italic text-[#a49a82]">{e.metaLabel}</span>
                {e.allDay && (
                  <button
                    type="button"
                    onClick={() => actions.dismissEvent(e.id)}
                    aria-label={`Dismiss ${e.title}`}
                    className="flex-none cursor-pointer px-1 text-[15px] text-[#b3a988] hover:text-[#8a4040]"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </>
        )}

        {isEmpty && <div className="py-8 text-[15px] italic text-[#a49a82]">No events or tasks for this day.</div>}
      </div>
    </div>
  );
}
