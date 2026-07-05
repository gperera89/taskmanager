"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AreaKey, CapturedKind, HabitCardVM, ItemKind, ModalState } from "./types";
import { deriveCalendarView } from "@/lib/derive";
import { useTaskbook } from "./store";
import { ModalContext } from "./ModalContext";
import Header from "./Header";
import BottomTabs from "./BottomTabs";
import CalendarRail from "./CalendarRail";
import TasksView from "./TasksView";
import ProjectsView from "./ProjectsView";
import RoutinesView from "./RoutinesView";
import HabitsView from "./HabitsView";
import DayView from "./DayView";
import ItemModal from "./ItemModal";
import SettingsModal from "./SettingsModal";

// The order of the portrait/mobile carousel. On desktop the calendar is a side rail
// instead of a swipeable panel, so it is dropped from the content flow there.
const CAROUSEL_VIEWS: AreaKey[] = ["tasks", "projects", "routines", "habits", "calendar"];

// Which Add-modal tab the current view should default to — so tapping "+ Add" from Projects
// opens straight to the Project form instead of always defaulting to Task.
const AREA_TO_KIND: Record<AreaKey, ItemKind> = {
  tasks: "task",
  projects: "project",
  routines: "routine",
  habits: "habit",
  calendar: "task",
  day: "task",
};

export default function TaskbookApp() {
  const { data, actions, raw, calendarEvents, nowMs } = useTaskbook();
  const [area, setArea] = useState<AreaKey>("tasks");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // While we programmatically snap the carousel to a tapped tab, ignore the scroll
  // events it emits so they don't fight the target we're animating toward.
  const snappingRef = useRef(false);

  // The viewed month for the calendar rail/panel — independent of "now", so the prev/next
  // arrows can browse other months. Defaults to the current month (lazy initializer: only
  // evaluated once, on mount, so later `nowMs` ticks don't yank the view back to today).
  const [viewYear, setViewYear] = useState(() => new Date(nowMs).getFullYear());
  const [viewMonth0, setViewMonth0] = useState(() => new Date(nowMs).getMonth());

  function goToMonth(year: number, month0: number) {
    setViewYear(year);
    setViewMonth0(month0);
    // A selected day belongs to whichever month it was picked in — stale once the view moves.
    setSelectedDay(null);
    setDayOpen(false);
  }
  function goPrevMonth() {
    goToMonth(viewMonth0 === 0 ? viewYear - 1 : viewYear, viewMonth0 === 0 ? 11 : viewMonth0 - 1);
  }
  function goNextMonth() {
    goToMonth(viewMonth0 === 11 ? viewYear + 1 : viewYear, viewMonth0 === 11 ? 0 : viewMonth0 + 1);
  }

  // The calendar view (month grid, day details, "Coming up") — reactive to optimistic edits,
  // dismissals, timezone changes, and month navigation (see lib/derive.ts's deriveCalendarView).
  const calendarView = useMemo(
    () => deriveCalendarView(raw, calendarEvents, nowMs, viewYear, viewMonth0),
    [raw, calendarEvents, nowMs, viewYear, viewMonth0]
  );

  // Mirror the lg breakpoint (1024px) used for the layout: below it we swipe a carousel,
  // at or above it we show the fixed content + calendar rail.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const modalActions = useMemo(
    () => ({
      openAdd: () => setModal({ mode: "add", initialKind: AREA_TO_KIND[area] }),
      openEdit: (state: Extract<ModalState, { mode: "edit" }>) => setModal(state),
    }),
    [area]
  );

  function scrollToArea(key: AreaKey, behavior: ScrollBehavior = "smooth") {
    const idx = CAROUSEL_VIEWS.indexOf(key);
    const el = scrollRef.current;
    if (idx < 0 || !el) return;
    snappingRef.current = true;
    el.scrollTo({ left: el.clientWidth * idx, behavior });
    window.setTimeout(() => {
      snappingRef.current = false;
    }, 400);
  }

  function selectTab(next: AreaKey) {
    setArea(next);
    setDayOpen(false);
    if (isMobile && CAROUSEL_VIEWS.includes(next)) scrollToArea(next);
  }

  // Keep the highlighted tab in sync with whichever panel the swipe settles on.
  function onCarouselScroll() {
    if (snappingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const next = CAROUSEL_VIEWS[idx];
    if (next && next !== area) setArea(next);
  }

  // On entering mobile (initial mount or rotating to portrait), line the carousel up
  // with the currently active view without animating (a DOM side effect).
  useEffect(() => {
    if (isMobile && CAROUSEL_VIEWS.includes(area)) scrollToArea(area, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // On desktop the calendar is the side rail, not a main view — never leave it as the active
  // area there. Corrected during render (React's adjust-state-on-change pattern).
  if (!isMobile && area === "calendar") setArea("tasks");

  // Looks up the entity a voice-capture notice points at, so "Edit" can reopen its normal
  // edit form instead of needing a bespoke voice-capture editing UI. Tasks are edited inline
  // on their row rather than through a modal, so "Edit" just jumps to the Tasks tab.
  function openEditForCapture(kind: CapturedKind, entityId: string) {
    if (kind === "task") {
      selectTab("tasks");
    } else if (kind === "project") {
      const item = data.projectCards.find((p) => p.id === entityId);
      if (item) setModal({ mode: "edit", kind: "project", item });
    } else if (kind === "routine") {
      const item = [...data.routineDaily, ...data.routineScheduled].find((r) => r.id === entityId);
      if (item) setModal({ mode: "edit", kind: "routine", item });
    } else if (kind === "habit") {
      const all = [data.habitFeatured, ...data.habitSuggested, ...data.habitOnTrack].filter(
        (h): h is HabitCardVM => h != null
      );
      const item = all.find((h) => h.id === entityId);
      if (item) setModal({ mode: "edit", kind: "habit", item });
    }
  }

  function clickDay(day: number) {
    if (selectedDay !== day) {
      setSelectedDay(day);
      setDayOpen(false);
    } else {
      setDayOpen(true);
      setArea("day");
    }
  }

  // Clicking one of the greyed leading/trailing days from an adjacent month (shown for grid
  // continuity) navigates to that month and selects the day directly, rather than requiring a
  // separate prev/next click first.
  function clickAdjacentDay(direction: "prev" | "next", day: number) {
    if (direction === "prev") {
      setViewYear(viewMonth0 === 0 ? viewYear - 1 : viewYear);
      setViewMonth0(viewMonth0 === 0 ? 11 : viewMonth0 - 1);
    } else {
      setViewYear(viewMonth0 === 11 ? viewYear + 1 : viewYear);
      setViewMonth0(viewMonth0 === 11 ? 0 : viewMonth0 + 1);
    }
    setSelectedDay(day);
    setDayOpen(false);
  }

  const dayDetail = selectedDay != null ? calendarView.dayDetails[selectedDay] : undefined;

  function viewFor(key: AreaKey) {
    switch (key) {
      case "tasks":
        return (
          <TasksView
            groups={data.taskGroups}
            remainingToday={data.tasksRemainingToday}
            query={query}
            categoryOptions={data.categoryOptions}
            projectOptions={data.projectOptions}
          />
        );
      case "projects":
        return (
          <ProjectsView
            cards={data.projectCards}
            activeCount={data.activeProjectCount}
            query={query}
            categoryOptions={data.categoryOptions}
            projectOptions={data.projectOptions}
          />
        );
      case "routines":
        return (
          <RoutinesView
            daily={data.routineDaily}
            scheduled={data.routineScheduled}
            total={data.routineTotalCount}
            query={query}
          />
        );
      case "habits":
        return (
          <HabitsView
            featured={data.habitFeatured}
            suggested={data.habitSuggested}
            onTrack={data.habitOnTrack}
            atRiskCount={data.habitAtRiskCount}
            query={query}
          />
        );
      case "calendar":
        return (
          <CalendarRail
            variant="panel"
            monthLabel={calendarView.monthLabel}
            year={calendarView.year}
            cells={calendarView.monthCells}
            selectedDay={selectedDay}
            dayOpen={dayOpen}
            dayDetail={dayDetail}
            upcoming={calendarView.upcoming}
            onClickDay={clickDay}
            onClickAdjacentDay={clickAdjacentDay}
            onPrevMonth={goPrevMonth}
            onNextMonth={goNextMonth}
            onDismissEvent={actions.dismissEvent}
          />
        );
      default:
        return null;
    }
  }

  return (
    <ModalContext.Provider value={modalActions}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#efe9dc] font-serif">
        <Header
          todayLabel={data.todayLabel}
          query={query}
          onQueryChange={setQuery}
          pendingCaptures={data.pendingCaptures}
          onEditCapture={openEditForCapture}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {isMobile ? (
          <div className="relative flex min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={onCarouselScroll}
              className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
            >
              {CAROUSEL_VIEWS.map((key) => (
                <section
                  key={key}
                  className="w-full flex-none snap-start overflow-y-auto px-5 py-6 pb-10"
                >
                  {viewFor(key)}
                </section>
              ))}
            </div>
            {area === "day" && dayDetail && (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-[#efe9dc] px-5 py-6 pb-10">
                <DayView detail={dayDetail} onBack={() => selectTab("calendar")} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex-1 overflow-y-auto px-11 py-8 pb-10">
              {viewFor(area)}
              {area === "day" && dayDetail && (
                <DayView detail={dayDetail} onBack={() => selectTab("tasks")} />
              )}
            </div>

            <CalendarRail
              monthLabel={calendarView.monthLabel}
              year={calendarView.year}
              cells={calendarView.monthCells}
              selectedDay={selectedDay}
              dayOpen={dayOpen}
              dayDetail={dayDetail}
              upcoming={calendarView.upcoming}
              onClickDay={clickDay}
              onClickAdjacentDay={clickAdjacentDay}
              onPrevMonth={goPrevMonth}
              onNextMonth={goNextMonth}
              onDismissEvent={actions.dismissEvent}
            />
          </div>
        )}

        <BottomTabs
          area={area}
          onSelect={selectTab}
          tasksRemainingToday={data.tasksRemainingToday}
          activeProjectCount={data.activeProjectCount}
          routineTotalCount={data.routineTotalCount}
          habitAtRiskCount={data.habitAtRiskCount}
          monthLabel={calendarView.monthLabel}
        />
      </div>

      {modal && (
        <ItemModal
          state={modal}
          projectOptions={data.projectOptions}
          categoryOptions={data.categoryOptions}
          onClose={() => setModal(null)}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          categoryOptions={data.categoryOptions}
          timeZone={raw.timeZone}
          onSetTimeZone={actions.setTimeZone}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </ModalContext.Provider>
  );
}
