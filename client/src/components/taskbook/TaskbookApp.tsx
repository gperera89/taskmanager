"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AreaKey, CapturedKind, ItemKind, ModalState, Mode } from "./types";
import { deriveCalendarView, deriveMyDay } from "@/lib/derive";
import { deriveTimeSuggestions } from "@/lib/timeSuggestions";
import { zonedYMD } from "@/lib/taskbookDates";
import { useTaskbook } from "./store";
import { ModalContext } from "./ModalContext";
import Header from "./Header";
import BottomTabs from "./BottomTabs";
import CalendarRail from "./CalendarRail";
import TasksView from "./TasksView";
import ProjectsView from "./ProjectsView";
import NotesView from "./NotesView";
import NotePage from "./NotePage";
import RoutinesView from "./RoutinesView";
import HabitsView from "./HabitsView";
import HabitHeatmap from "./HabitHeatmap";
import DayView from "./DayView";
import ItemModal from "./ItemModal";
import SettingsModal from "./SettingsModal";
import LogbookModal from "./LogbookModal";
import ReviewModal from "./ReviewModal";
import StatusBanners from "./StatusBanners";
import Toasts from "./Toasts";
import ReminderSheet, { parseReminderTarget, type ReminderTarget } from "./ReminderSheet";

// The order of the portrait/mobile carousel. On desktop the calendar is a side rail
// instead of a swipeable panel, so it is dropped from the content flow there.
const CAROUSEL_VIEWS: AreaKey[] = ["tasks", "projects", "notes", "routines", "habits", "calendar"];

// Which Add-modal tab the current view should default to — so tapping "+ Add" from Projects
// opens straight to the Project form instead of always defaulting to Task.
const AREA_TO_KIND: Record<AreaKey, ItemKind> = {
  tasks: "task",
  projects: "project",
  notes: "task", // unused — "Add" on the Notes tab starts a new note instead (see openAdd)
  routines: "routine",
  habits: "habit",
  calendar: "task",
  day: "task",
};

// Digit keys → main views, for the Stream Deck profile (each key just sends a plain keypress).
const AREA_SHORTCUTS: Record<string, AreaKey> = {
  "1": "tasks",
  "2": "projects",
  "3": "routines",
  "4": "habits",
  "5": "calendar",
  // Notes came later; it takes the next free digit rather than renumbering the Stream Deck keys.
  "6": "notes",
};

// Letter keys → home/all/work mode, matching ModeToggle's order.
const MODE_SHORTCUTS: Record<string, Mode> = { h: "home", a: "all", w: "work" };

// Below the lg breakpoint (1024px) the views are a swipeable carousel; at or above it, fixed
// content beside the calendar rail.
const MOBILE_QUERY = "(max-width: 1023px)";

export default function TaskbookApp() {
  const { data, actions, raw, calendarEvents, nowMs, mode, setMode } = useTaskbook();
  const [area, setArea] = useState<AreaKey>("tasks");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logbookOpen, setLogbookOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // The habit whose completion heatmap is open (by id, so it tracks live optimistic edits).
  const [heatmapHabitId, setHeatmapHabitId] = useState<string | null>(null);
  // The item a tapped reminder points at (see ReminderSheet). Read from the launch URL directly:
  // like `isMobile` below, this component only renders on the client.
  const [reminderTarget, setReminderTarget] = useState<ReminderTarget | null>(() =>
    parseReminderTarget(new URLSearchParams(window.location.search).get("open"))
  );
  useEffect(() => {
    // Drop the parameter so a reload (or the next launch from the Home Screen) doesn't reopen it.
    const url = new URL(window.location.href);
    if (url.searchParams.has("open")) {
      url.searchParams.delete("open");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    // A reminder tapped while Cura was already running arrives as a message instead of a launch.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "cura-open") return;
      const target = parseReminderTarget(typeof event.data.target === "string" ? event.data.target : null);
      if (target) setReminderTarget(target);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  // The note open full-screen in the editor, if any — it sits over whichever tab opened it, so
  // closing it lands back where you were.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  // Read straight from the viewport: this component only ever renders on the client (the store
  // draws the static frame until it's ready — see StoreProvider), so there's no server render to
  // match, and starting from `false` would paint the desktop layout on a phone for a frame.
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
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
    () => deriveCalendarView(raw, calendarEvents, nowMs, viewYear, viewMonth0, mode),
    [raw, calendarEvents, nowMs, viewYear, viewMonth0, mode]
  );

  // Mirror the lg breakpoint (1024px) used for the layout: below it we swipe a carousel,
  // at or above it we show the fixed content + calendar rail.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const modalActions = useMemo(
    () => ({
      openAdd: () =>
        area === "notes" ? setOpenNoteId(actions.addNote({})) : setModal({ mode: "add", initialKind: AREA_TO_KIND[area] }),
      openEdit: (state: Extract<ModalState, { mode: "edit" }>) => setModal(state),
      openHeatmap: (habitId: string) => setHeatmapHabitId(habitId),
      openNote: (noteId: string) => setOpenNoteId(noteId),
    }),
    [area, actions]
  );
  const closeNote = useCallback(() => setOpenNoteId(null), []);

  // The shortcut handler is registered once; it reads the active area through a ref so "n"
  // always opens the Add form matching the tab currently in view.
  const areaRef = useRef(area);
  useEffect(() => {
    areaRef.current = area;
  }, [area]);

  // Same trick for the callbacks that close over per-render state (selectTab reads
  // isMobile, openMyDay reads nowMs/timeZone): the once-registered handler always goes
  // through this ref so it acts on the current render's values.
  const shortcutRef = useRef<{
    selectTab: (next: AreaKey) => void;
    openMyDay: () => void;
    newNote: () => void;
    isMobile: boolean;
  }>({ selectTab: () => {}, openMyDay: () => {}, newNote: () => {}, isMobile: false });
  useEffect(() => {
    shortcutRef.current = { selectTab, openMyDay, newNote: () => setOpenNoteId(actions.addNote({})), isMobile };
  });

  // Keyboard shortcuts (also driven by a Stream Deck profile sending plain keypresses):
  // n = new item, / = focus search, 1–5 = switch view, d = My Day, s/l/r = settings/
  // logbook/review, h/a/w = mode, Escape = close whatever's open. Skipped while typing
  // in any field so the letters still type normally.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Escape inside the note editor is CodeMirror's (it clears a selection); the note
        // closes from its Back button.
        if ((e.target as HTMLElement | null)?.closest?.(".cm-editor")) return;
        setOpenNoteId(null);
        setModal(null);
        setSettingsOpen(false);
        setLogbookOpen(false);
        setReviewOpen(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const api = shortcutRef.current;
      if (e.key === "n") {
        e.preventDefault();
        if (areaRef.current === "notes") api.newNote();
        else setModal({ mode: "add", initialKind: AREA_TO_KIND[areaRef.current] });
      } else if (e.key === "/") {
        e.preventDefault();
        // The search field is rendered per view (and once per carousel panel on mobile), so
        // focus whichever copy is in the DOM first rather than looking one up by id.
        document.querySelector<HTMLInputElement>("[data-taskbook-search]")?.focus();
      } else if (AREA_SHORTCUTS[e.key]) {
        // Calendar is the side rail on desktop, not a main view — "5" is mobile-only
        // (selecting it on desktop would just get render-corrected back to Tasks).
        const next = AREA_SHORTCUTS[e.key];
        if (next === "calendar" && !api.isMobile) return;
        e.preventDefault();
        api.selectTab(next);
      } else if (e.key === "d") {
        e.preventDefault();
        api.openMyDay();
      } else if (e.key === "s") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "l") {
        e.preventDefault();
        setLogbookOpen(true);
      } else if (e.key === "r") {
        e.preventDefault();
        setReviewOpen(true);
      } else if (MODE_SHORTCUTS[e.key]) {
        e.preventDefault();
        setMode(MODE_SHORTCUTS[e.key]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // setMode and the modal-open setters are stable useState setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const item = data.routineList.find((r) => r.id === entityId);
      if (item) setModal({ mode: "edit", kind: "routine", item });
    } else if (kind === "habit") {
      const item = data.habits.find((h) => h.id === entityId);
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
  // The My Day timeline for the selected day — re-derived on every optimistic edit / clock tick,
  // which is what makes completions/drags/pushes reflow the schedule instantly.
  // Suggested slots today for overdue/untimed tasks — a second My Day pass (see timeSuggestions.ts).
  const timeSuggestions = useMemo(
    () => deriveTimeSuggestions(raw, calendarEvents, nowMs, mode),
    [raw, calendarEvents, nowMs, mode]
  );
  const myDay = useMemo(
    () => (selectedDay != null ? deriveMyDay(raw, calendarEvents, nowMs, viewYear, viewMonth0, selectedDay, mode) : undefined),
    [raw, calendarEvents, nowMs, viewYear, viewMonth0, selectedDay, mode]
  );

  // "My Day" header shortcut: jump straight to today's full day view from anywhere (including
  // a different viewed month).
  function openMyDay() {
    const t = zonedYMD(new Date(nowMs), raw.timeZone);
    setViewYear(t.year);
    setViewMonth0(t.month0);
    setSelectedDay(t.day);
    setDayOpen(true);
    setArea("day");
  }
  // Look the heatmap habit up live so optimistic completion toggles re-render its grid.
  const heatmapHabit = heatmapHabitId != null ? data.habits.find((h) => h.id === heatmapHabitId) : undefined;

  function viewFor(key: AreaKey) {
    switch (key) {
      case "tasks":
        return (
          <TasksView
            groups={data.taskGroups}
            remainingToday={data.tasksRemainingToday}
            query={query}
            onQueryChange={setQuery}
            categoryOptions={data.categoryOptions}
            projectOptions={data.projectOptions}
            timeSuggestions={timeSuggestions}
          />
        );
      case "projects":
        return (
          <ProjectsView
            cards={data.projectCards}
            activeCount={data.activeProjectCount}
            query={query}
            onQueryChange={setQuery}
            categoryOptions={data.categoryOptions}
            projectOptions={data.projectOptions}
          />
        );
      case "notes":
        return <NotesView notes={data.notes} query={query} onQueryChange={setQuery} />;
      case "routines":
        return (
          <RoutinesView
            routines={data.routineList}
            total={data.routineTotalCount}
            query={query}
            onQueryChange={setQuery}
          />
        );
      case "habits":
        return (
          <HabitsView
            habits={data.habits}
            atRiskCount={data.habitAtRiskCount}
            query={query}
            onQueryChange={setQuery}
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
            countdowns={data.countdowns}
            onEditCountdown={(item) => setModal({ mode: "edit", kind: "event", item })}
            onRemoveCountdown={actions.removeCountdown}
            onClickDay={clickDay}
            onClickAdjacentDay={clickAdjacentDay}
            onPrevMonth={goPrevMonth}
            onNextMonth={goNextMonth}
            onToggleTask={actions.toggleTask}
            onDismissEvent={actions.dismissEvent}
            onRestoreEvent={actions.restoreEvent}
          />
        );
      default:
        return null;
    }
  }

  return (
    <ModalContext.Provider value={modalActions}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-(--surface) font-serif">
        <Header
          todayLabel={data.todayLabel}
          pendingCaptures={data.pendingCaptures}
          onEditCapture={openEditForCapture}
          onOpenMyDay={openMyDay}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenLogbook={() => setLogbookOpen(true)}
          onOpenReview={() => setReviewOpen(true)}
          isMobile={isMobile}
        />
        <StatusBanners />

        {/* min-w-0 throughout: this row holds the carousel, whose min-content width is every
            panel side by side — without it the row grows to fit them and pushes the page wide. */}
        <div className="relative flex min-h-0 min-w-0 flex-1">
        {isMobile ? (
          <div className="relative flex min-h-0 min-w-0 flex-1">
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
            {area === "day" && dayDetail && myDay && (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-(--surface) px-5 py-6 pb-10">
                <DayView detail={dayDetail} myDay={myDay} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1">
            <div className="flex-1 overflow-y-auto px-11 py-8 pb-10">
              {viewFor(area)}
              {area === "day" && dayDetail && myDay && (
                <DayView detail={dayDetail} myDay={myDay} />
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
              countdowns={data.countdowns}
              onEditCountdown={(item) => setModal({ mode: "edit", kind: "event", item })}
              onRemoveCountdown={actions.removeCountdown}
              onClickDay={clickDay}
              onClickAdjacentDay={clickAdjacentDay}
              onPrevMonth={goPrevMonth}
              onNextMonth={goNextMonth}
              onToggleTask={actions.toggleTask}
              onDismissEvent={actions.dismissEvent}
              onRestoreEvent={actions.restoreEvent}
            />
          </div>
        )}
        {openNoteId && (
          <NotePage
            key={openNoteId}
            noteId={openNoteId}
            isMobile={isMobile}
            onClose={closeNote}
            categoryOptions={data.categoryOptions}
            projectOptions={data.projectOptions}
            projectCards={data.projectCards}
          />
        )}
        </div>

        <BottomTabs
          area={area}
          onSelect={(next) => {
            setOpenNoteId(null);
            selectTab(next);
          }}
          noteCount={data.notes.length}
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

      {logbookOpen && <LogbookModal onClose={() => setLogbookOpen(false)} />}
      {reviewOpen && <ReviewModal onClose={() => setReviewOpen(false)} />}
      {heatmapHabit && <HabitHeatmap habit={heatmapHabit} onClose={() => setHeatmapHabitId(null)} />}
      {reminderTarget && (
        <ReminderSheet
          target={reminderTarget}
          onClose={() => setReminderTarget(null)}
          onShowList={(next) => {
            setReminderTarget(null);
            selectTab(next);
          }}
        />
      )}
      <Toasts />
    </ModalContext.Provider>
  );
}
