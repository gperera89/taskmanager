"use client";

import { useTaskbook } from "./store";
import { useModalActions } from "./ModalContext";
import { AnimatedList } from "./motion";
import { NoteGlyph } from "./ProjectsView";
import SearchBar from "./SearchBar";
import { labelClass } from "./shared";
import type { NoteListItemVM } from "./types";

// The Notes tab: every note, grouped by the project it belongs to (active projects first, in
// order of their most recently edited note), with unattached notes under "Unfiled" at the top —
// that's where fresh ideas land before they've earned a project.
export default function NotesView({
  notes,
  query,
  onQueryChange,
}: {
  notes: NoteListItemVM[];
  query: string;
  onQueryChange: (v: string) => void;
}) {
  const { actions } = useTaskbook();
  const { openNote } = useModalActions();
  const q = query.trim().toLowerCase();
  const filtered = q ? notes.filter((n) => n.searchText.includes(q)) : notes;

  // `notes` arrives newest-first, so first appearance orders the groups by recency too.
  const groups: { key: string; label: string; completed: boolean; notes: NoteListItemVM[] }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();
  const unfiled = { key: "__unfiled__", label: "Unfiled", completed: false, notes: [] as NoteListItemVM[] };
  for (const note of filtered) {
    if (!note.projectId) {
      unfiled.notes.push(note);
      continue;
    }
    let group = byKey.get(note.projectId);
    if (!group) {
      group = { key: note.projectId, label: note.projectName ?? "Project", completed: note.projectCompleted, notes: [] };
      byKey.set(note.projectId, group);
      groups.push(group);
    }
    group.notes.push(note);
  }
  const ordered = [
    ...(unfiled.notes.length ? [unfiled] : []),
    ...groups.filter((g) => !g.completed),
    ...groups.filter((g) => g.completed),
  ];

  return (
    <div>
      <div className="flex items-end justify-between">
        <div className="font-script text-[62px] leading-[0.8] text-(--ink)">Notes</div>
        <button
          type="button"
          onClick={() => openNote(actions.addNote({}))}
          className="mb-1.5 cursor-pointer rounded-full border border-(--border-strong) bg-(--card) px-3.5 py-1 text-[13px] text-(--info) hover:border-(--accent-text) hover:text-(--accent-text)"
        >
          + New note
        </button>
      </div>
      <div className="my-5 mb-1 h-px bg-(--rule)" />

      <SearchBar query={query} onQueryChange={onQueryChange} placeholder="Search notes…" />

      {ordered.length === 0 && (
        <p className="py-8 text-[15px] italic text-(--ink-soft)">
          {q ? "No notes match your search." : "No notes yet. Start one to think something through."}
        </p>
      )}

      <AnimatedList className="flex max-w-[760px] flex-col gap-7">
        {ordered.map((group) => (
          <section key={group.key} data-flip-id={`notes-${group.key}`}>
            <div className={`${labelClass} mb-2 ${group.completed ? "line-through" : ""}`}>{group.label}</div>
            <div className="flex flex-col divide-y divide-(--border-soft) rounded-xl border border-(--border-soft) bg-(--card)">
              {group.notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => openNote(note.id)}
                  className="flex cursor-pointer flex-col gap-0.5 px-4 py-3 text-left hover:bg-(--info-wash-soft)"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5 text-[16px] font-semibold text-(--ink)">
                      <span className="text-(--ink-faint)">
                        <NoteGlyph />
                      </span>
                      <span className="truncate">{note.title}</span>
                    </span>
                    <span className="flex-none text-[12px] text-(--ink-faint)">{note.updatedLabel}</span>
                  </span>
                  {note.snippet && <span className="truncate pl-5 text-[13.5px] text-(--ink-muted)">{note.snippet}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </AnimatedList>
    </div>
  );
}
