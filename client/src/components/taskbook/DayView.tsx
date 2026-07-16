"use client";

import { useTaskbook } from "./store";
import { FitText } from "./shared";
import MyDayPlanner from "./MyDayPlanner";
import type { DayDetailVM, MyDayVM } from "./types";

// The full-day view ("My Day"): heading + the timeline planner. The old flat lists of
// tasks/projects/events were replaced by MyDayPlanner, which merges everything due or
// scheduled that day into one editable 5am–9pm timeline plus tray and look-ahead sections.
export default function DayView({ detail, myDay }: { detail: DayDetailVM; myDay: MyDayVM }) {
  const { actions } = useTaskbook();
  // Today always renders the full planner (the suggestions section and template anchors live
  // there); other days collapse to the empty note when truly blank.
  const isEmpty =
    !myDay.isToday &&
    myDay.timeline.length === 0 &&
    myDay.tray.length === 0 &&
    myDay.allDayEvents.length === 0 &&
    myDay.lookahead.length === 0;

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

      {isEmpty ? (
        <div className="max-w-[680px] py-8 text-[15px] italic text-(--ink-soft)">No events or tasks for this day.</div>
      ) : (
        <MyDayPlanner myDay={myDay} />
      )}
    </div>
  );
}
