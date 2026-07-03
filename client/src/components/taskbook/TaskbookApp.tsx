"use client";

import { useMemo, useState } from "react";
import type { AreaKey, CapturedKind, HabitCardVM, ModalState, TaskbookData } from "./types";
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

export default function TaskbookApp({ data }: { data: TaskbookData }) {
  const [area, setArea] = useState<AreaKey>("tasks");
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [dayOpen, setDayOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const modalActions = useMemo(
    () => ({
      openAdd: () => setModal({ mode: "add" }),
      openEdit: (state: Extract<ModalState, { mode: "edit" }>) => setModal(state),
    }),
    []
  );

  function selectTab(next: AreaKey) {
    setArea(next);
    setDayOpen(false);
  }

  // Looks up the entity a voice-capture notice points at, so "Edit" can reopen its normal
  // edit form instead of needing a bespoke voice-capture editing UI. Tasks are edited inline
  // on their row rather than through a modal, so "Edit" just jumps to the Tasks tab.
  function openEditForCapture(kind: CapturedKind, entityId: string) {
    if (kind === "task") {
      setArea("tasks");
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

  const dayDetail = selectedDay != null ? data.dayDetails[selectedDay] : undefined;

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

        <div className="flex min-h-0 flex-1">
          <div className="flex-1 overflow-y-auto px-11 py-8 pb-10">
            {area === "tasks" && (
              <TasksView
                groups={data.taskGroups}
                remainingToday={data.tasksRemainingToday}
                query={query}
                categoryOptions={data.categoryOptions}
                projectOptions={data.projectOptions}
              />
            )}
            {area === "projects" && (
              <ProjectsView
                cards={data.projectCards}
                activeCount={data.activeProjectCount}
                query={query}
                categoryOptions={data.categoryOptions}
              />
            )}
            {area === "routines" && (
              <RoutinesView
                daily={data.routineDaily}
                scheduled={data.routineScheduled}
                total={data.routineTotalCount}
                query={query}
              />
            )}
            {area === "habits" && (
              <HabitsView
                featured={data.habitFeatured}
                suggested={data.habitSuggested}
                onTrack={data.habitOnTrack}
                atRiskCount={data.habitAtRiskCount}
                query={query}
              />
            )}
            {area === "day" && dayDetail && (
              <DayView detail={dayDetail} onBack={() => selectTab("tasks")} />
            )}
          </div>

          <CalendarRail
            monthLabel={data.monthLabel}
            year={data.year}
            cells={data.monthCells}
            selectedDay={selectedDay}
            dayOpen={dayOpen}
            dayDetail={dayDetail}
            upcoming={data.upcoming}
            onClickDay={clickDay}
          />
        </div>

        <BottomTabs
          area={area}
          onSelect={selectTab}
          tasksRemainingToday={data.tasksRemainingToday}
          activeProjectCount={data.activeProjectCount}
          routineTotalCount={data.routineTotalCount}
          habitAtRiskCount={data.habitAtRiskCount}
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
        <SettingsModal categoryOptions={data.categoryOptions} onClose={() => setSettingsOpen(false)} />
      )}
    </ModalContext.Provider>
  );
}
