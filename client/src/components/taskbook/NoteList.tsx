"use client";

// A list of notes — title, when it was last edited and the first line of prose — as it appears on
// a project card, the Unfiled card and under a task. Long lists show the first few and fold the
// rest behind "+N more".

import { useState } from "react";
import { useModalActions } from "./ModalContext";
import type { NoteListItemVM } from "./types";

export const NOTES_SHOWN = 3;

export default function NoteList({
  notes,
  onAdd,
  showTask = false,
  compact = false,
  expandAll = false,
}: {
  notes: NoteListItemVM[];
  // Creates a note and returns its id, which is opened straight away. Omit for no "+ Note".
  onAdd?: () => string;
  // Mark notes that are about a task with the task's name (a project card's list).
  showTask?: boolean;
  // Smaller type, for the list under a task row.
  compact?: boolean;
  // Skip the fold — search results show every match.
  expandAll?: boolean;
}) {
  const { openNote } = useModalActions();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded || expandAll ? notes : notes.slice(0, NOTES_SHOWN);
  const hidden = notes.length - shown.length;

  return (
    <div className="flex flex-col">
      {shown.map((note) => (
        <button
          key={note.id}
          type="button"
          onClick={() => openNote(note.id)}
          className="flex min-w-0 cursor-pointer gap-2 border-t border-(--border-soft) py-1.5 text-left first:border-t-0 hover:bg-(--info-wash-soft)"
        >
          <span className="mt-[3px] text-(--ink-faint)">
            <NoteGlyph size={compact ? 13 : 14} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-baseline justify-between gap-3">
              <span
                className={`truncate font-semibold text-(--info) ${compact ? "text-[13.5px]" : "text-[14.5px]"}`}
              >
                {note.title}
              </span>
              <span className="flex-none text-[11.5px] text-(--ink-faint)">{note.updatedLabel}</span>
            </span>
            {showTask && note.taskTitle && (
              <span className="truncate text-[12px] text-(--ink-muted)">↳ {note.taskTitle}</span>
            )}
            {note.snippet && (
              <span className={`truncate text-(--ink-muted) ${compact ? "text-[12.5px]" : "text-[13px]"}`}>
                {note.snippet}
              </span>
            )}
          </span>
        </button>
      ))}
      {(hidden > 0 || onAdd) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap pt-1 text-[12.5px]">
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="cursor-pointer text-(--ink-muted) hover:text-(--info)"
            >
              +{hidden} more {hidden === 1 ? "note" : "notes"}
            </button>
          )}
          {expanded && notes.length > NOTES_SHOWN && !expandAll && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="cursor-pointer text-(--ink-muted) hover:text-(--info)"
            >
              Show fewer
            </button>
          )}
          {onAdd && (
            <button
              type="button"
              onClick={() => openNote(onAdd())}
              className="cursor-pointer text-(--ink-faint) hover:text-(--info)"
            >
              + Note
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Material Symbols "description" — a page with lines, marking a link to a note.
export function NoteGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" className="flex-none" aria-hidden>
      <path
        d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"
        style={{ fill: "currentColor" }}
      />
    </svg>
  );
}
