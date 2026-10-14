"use client";

// A note, open full-screen: a wide writing column on the left, and the project it belongs to on
// the right (desktop) or in a pull-up sheet (phone) — the same ProjectCard as the Projects tab,
// so tasks can be added, ticked and dated without leaving the note. An Unfiled note's panel
// offers to attach it to a project, or to build a new project out of it.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTaskbook } from "./store";
import { useModalActions } from "./ModalContext";
import { ProjectCard } from "./ProjectsView";
import { TaskRow } from "./TasksView";
import type { MarkdownEditorHandle } from "./MarkdownEditor";
import { labelClass, selectCaretStyle, SELECT_CARET_INFO } from "./shared";
import type { CategoryOption, ProjectCardVM, ProjectOption } from "./types";

const MarkdownEditor = dynamic(() => import("./MarkdownEditor"), {
  ssr: false,
  loading: () => <div className="min-h-[50vh]" />,
});

// Typing is saved this long after the last keystroke — each save is one queued write (and one
// database operation), so this trades a little durability for not writing on every letter.
const SAVE_DEBOUNCE_MS = 1200;
// A copy of this note arriving from the server (another device's edit) is only taken while the
// editor has been idle this long — a refresh that raced a save in flight would otherwise hand
// back the text from just before it and roll back the last few words.
const REMOTE_QUIET_MS = 4000;

export default function NotePage({
  noteId,
  isMobile,
  onClose,
  categoryOptions,
  projectOptions,
  projectCards,
}: {
  noteId: string;
  isMobile: boolean;
  onClose: () => void;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
  projectCards: ProjectCardVM[];
}) {
  const { raw, actions, subscribeNoteEdits } = useTaskbook();
  const note = raw.notes.find((n) => n.id === noteId);
  const [panelOpen, setPanelOpen] = useState(false);

  // --- Body: local-first, saved on a debounce ---
  // `savedRef` is the text the store last saw for this note; `draftRef` is what's in the editor.
  // They differ exactly while there's typing waiting to be saved.
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const onEditorReady = useCallback((handle: MarkdownEditorHandle | null) => {
    editorRef.current = handle;
  }, []);
  const savedRef = useRef(note?.body ?? "");
  const draftRef = useRef(note?.body ?? "");
  const lastLocalEditRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);

  // Runs `transform` over the editor's text (only the changed lines are touched, so the caret
  // stays put) and keeps the draft in step. Falls back to the draft if the editor isn't up yet.
  const applyToEditor = useCallback((transform: (doc: string) => string) => {
    draftRef.current = editorRef.current ? editorRef.current.apply(transform) : transform(draftRef.current);
  }, []);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const draft = draftRef.current;
    if (draft === savedRef.current) return;
    // The store syncs the checkbox lines with their tasks and hands back the body as it should now
    // read — new checkbox lines tagged with their block ids — for the editor to adopt.
    const stored = actions.saveNoteBody(noteId, draft);
    savedRef.current = stored;
    if (stored !== draft) applyToEditor((doc) => (doc === draft ? stored : doc));
  }, [actions, noteId, applyToEditor]);

  const onDocChange = useCallback(
    (text: string) => {
      draftRef.current = text;
      lastLocalEditRef.current = Date.now();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  // Save on the way out: closing the note, backgrounding the app, or the tab going away.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushSave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushSave);
      flushSave();
    };
  }, [flushSave]);

  // Edits to this note made elsewhere in Cura — a linked task ticked in the side panel, renamed or
  // deleted — arrive as line transforms. They apply to both the saved text and the live draft, so
  // unsaved typing elsewhere in the note survives, and a note with nothing unsaved stays clean
  // (the server makes the same edit itself, so there's nothing to save).
  useEffect(
    () =>
      subscribeNoteEdits(noteId, (transform) => {
        savedRef.current = transform(savedRef.current);
        applyToEditor(transform);
      }),
    [noteId, subscribeNoteEdits, applyToEditor]
  );

  // Another device's edit landed (via the store's reconcile). Take it only when nothing local is
  // unsaved and the editor has been quiet a moment; otherwise the local text wins and its next
  // save overwrites the server copy (last write wins, same as every other field in Cura).
  const serverBody = note?.body;
  useEffect(() => {
    if (serverBody === undefined || serverBody === savedRef.current) return;
    const dirty = draftRef.current !== savedRef.current;
    if (dirty || Date.now() - lastLocalEditRef.current < REMOTE_QUIET_MS) return;
    savedRef.current = serverBody;
    applyToEditor(() => serverBody);
  }, [serverBody, applyToEditor]);

  // --- Title ---
  const [titleDraft, setTitleDraft] = useState(note?.title ?? "");
  const [titleFrom, setTitleFrom] = useState(note?.title);
  const [titleFocused, setTitleFocused] = useState(false);
  if (note && note.title !== titleFrom) {
    setTitleFrom(note.title);
    if (!titleFocused) setTitleDraft(note.title);
  }
  function commitTitle() {
    const next = titleDraft.trim() || "Untitled";
    if (note && next !== note.title) actions.renameNote(noteId, next);
    setTitleDraft(next);
  }

  // The note was deleted (here, or on another device and pulled in by a refresh).
  useEffect(() => {
    if (!note) onClose();
  }, [note, onClose]);
  if (!note) return null;

  const project = note.projectId ? projectCards.find((p) => p.id === note.projectId) : undefined;
  // A project hidden by the work/home mode filter still exists — keep its name for the picker.
  const projectName = note.projectId ? projectOptions.find((p) => p.id === note.projectId)?.name : undefined;

  function createProjectFromNote() {
    flushSave();
    const name = window.prompt("Name for the new project", note!.title === "Untitled" ? "" : note!.title);
    if (name === null || !name.trim()) return;
    const projectId = actions.addProject({ name: name.trim() });
    actions.setNoteProject(noteId, projectId);
  }

  // The task this note is about, if it's still loaded (a long-done task drops out of the fetch).
  const aboutTask = note.taskId
    ? raw.tasks.flatMap((t) => [t, ...t.subtasks]).find((t) => t.id === note.taskId)
    : undefined;

  const panel = (
    <div className="flex flex-col gap-4">
      {note.taskId && (
        <div>
          <div className={`${labelClass} mb-1`}>About this task</div>
          <div
            className="text-[15px] leading-snug"
            style={{
              color: aboutTask?.isCompleted ? "var(--ink-soft)" : "var(--ink)",
              textDecoration: aboutTask?.isCompleted ? "line-through" : "none",
            }}
          >
            {aboutTask?.title ?? "A completed task"}
          </div>
        </div>
      )}
      {project ? (
        <ProjectCard project={project} categoryOptions={categoryOptions} projectOptions={projectOptions} hideNotes />
      ) : note.projectId ? (
        <p className="text-[13.5px] italic text-(--ink-soft)">
          {projectName ?? "This project"} is hidden by the current work/home filter.
        </p>
      ) : (
        <div className="rounded-xl border border-dashed border-(--border-strong) px-5 py-5">
          <div className={labelClass}>Unfiled</div>
          <p className="mt-2 text-[14px] leading-snug text-(--ink-muted)">
            This note isn&apos;t part of a project yet. Attach it to one above, or turn it into a new project and start
            adding tasks beside it.
          </p>
          <button
            type="button"
            onClick={createProjectFromNote}
            className="mt-3 cursor-pointer rounded-full bg-(--accent) px-3.5 py-1.5 text-[13px] text-(--on-accent)"
          >
            Create project from note
          </button>
        </div>
      )}
      {!note.projectId && (
        <NoteTasks noteId={noteId} categoryOptions={categoryOptions} projectOptions={projectOptions} />
      )}
      {project && <SiblingNotes projectId={project.id} currentId={noteId} />}
    </div>
  );

  return (
    <div className="absolute inset-0 z-20 flex bg-(--surface)">
      <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-10 pt-4 lg:px-14 lg:pt-7">
        <div className="mx-auto max-w-[720px]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                flushSave();
                onClose();
              }}
              className="-ml-1 flex cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-[14px] text-(--info) hover:text-(--accent-text)"
            >
              <svg width="18" height="18" viewBox="0 -960 960 960" aria-hidden>
                <path d="M400-80 0-480l400-400 71 71-329 329 329 329-71 71Z" style={{ fill: "currentColor" }} />
              </svg>
              Back
            </button>
            <div className="flex-1 max-lg:hidden" />
            <select
              aria-label="Project"
              value={note.projectId ?? ""}
              onChange={(e) => actions.setNoteProject(noteId, e.target.value || null)}
              className="min-w-0 cursor-pointer truncate rounded-full max-lg:flex-1 lg:max-w-[260px] border-none bg-(--info-wash) px-3 py-1 text-[12.5px] text-(--info) outline-none"
              style={selectCaretStyle(SELECT_CARET_INFO)}
            >
              <option value="">Unfiled</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {isMobile && (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="flex-none cursor-pointer whitespace-nowrap rounded-full border border-(--border-strong) px-3 py-1 text-[12.5px] text-(--ink-muted)"
              >
                {project ? `Tasks ${project.done}/${project.total}` : "Project"}
              </button>
            )}
            <button
              type="button"
              title="Delete note"
              aria-label="Delete note"
              onClick={() => {
                flushSave();
                actions.removeNote(noteId);
              }}
              className="flex flex-none cursor-pointer items-center p-1 text-(--ink-faint) hover:text-(--danger)"
            >
              <svg width="18" height="18" viewBox="0 -960 960 960" aria-hidden>
                <path
                  d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"
                  style={{ fill: "currentColor" }}
                />
              </svg>
            </button>
          </div>

          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onFocus={(e) => {
              setTitleFocused(true);
              if (note.title === "Untitled") e.currentTarget.select();
            }}
            onBlur={() => {
              setTitleFocused(false);
              commitTitle();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Enter moves on into the body, like Obsidian's inline title.
                editorRef.current?.focus();
              }
            }}
            placeholder="Untitled"
            aria-label="Note title"
            // A brand-new note starts on its title, selected, ready to be named.
            autoFocus={note.title === "Untitled" && note.body === ""}
            className="mt-5 w-full bg-transparent text-[30px] font-semibold leading-tight text-(--ink) outline-none placeholder:text-(--ink-ghost) lg:text-[34px]"
          />
          <div className="mb-5 mt-1 h-px bg-(--rule)" />

          <MarkdownEditor
            key={noteId}
            initialDoc={note.body}
            onReady={onEditorReady}
            onDocChange={onDocChange}
            autoFocus={note.body === "" && note.title !== "Untitled"}
          />
        </div>
      </div>

      {!isMobile && (
        <aside className="w-[400px] flex-none overflow-y-auto border-l border-(--border) bg-(--surface-rail) px-6 py-7">
          {panel}
        </aside>
      )}

      {isMobile && panelOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end bg-(--overlay)" onClick={() => setPanelOpen(false)}>
          <div
            className="max-h-[80%] overflow-y-auto rounded-t-2xl bg-(--surface) px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-(--border-strong)" />
            {panel}
          </div>
        </div>
      )}
    </div>
  );
}

// An Unfiled note's checkbox lines are standalone tasks — listed in the panel so they can be
// dated and categorised like any other task.
function NoteTasks({
  noteId,
  categoryOptions,
  projectOptions,
}: {
  noteId: string;
  categoryOptions: CategoryOption[];
  projectOptions: ProjectOption[];
}) {
  const { raw, data } = useTaskbook();
  const ids = new Set(raw.tasks.filter((t) => t.noteId === noteId).map((t) => t.id));
  const tasks = data.taskGroups.flatMap((g) => g.tasks).filter((t) => ids.has(t.id));
  return (
    <div>
      <div className={`${labelClass} mb-2`}>Tasks from this note</div>
      {tasks.length === 0 ? (
        <p className="text-[13.5px] italic leading-snug text-(--ink-soft)">
          Type <span className="not-italic">- [ ]</span> at the start of a line to turn it into a task.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} categoryOptions={categoryOptions} projectOptions={projectOptions} />
          ))}
        </div>
      )}
    </div>
  );
}

// The project's other notes, under its card in the side panel — hop between them without going
// back to the list.
function SiblingNotes({ projectId, currentId }: { projectId: string; currentId: string }) {
  const { raw, actions } = useTaskbook();
  const siblings = raw.notes
    .filter((n) => n.projectId === projectId && n.id !== currentId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return (
    <div>
      <div className={`${labelClass} mb-2`}>Other notes</div>
      <NoteLinks ids={siblings.map((n) => ({ id: n.id, title: n.title }))} />
      <NewNoteLink onCreate={() => actions.addNote({ projectId })} />
    </div>
  );
}

function NoteLinks({ ids }: { ids: { id: string; title: string }[] }) {
  const open = useOpenNote();
  if (ids.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {ids.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => open(n.id)}
          className="cursor-pointer truncate text-left text-[14px] text-(--info) hover:text-(--accent-text)"
        >
          {n.title}
        </button>
      ))}
    </div>
  );
}

function NewNoteLink({ onCreate }: { onCreate: () => string }) {
  const open = useOpenNote();
  return (
    <button
      type="button"
      onClick={() => open(onCreate())}
      className={`${labelClass} cursor-pointer hover:text-(--info)`}
    >
      + New note
    </button>
  );
}

function useOpenNote() {
  return useModalActions().openNote;
}
