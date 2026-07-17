"use client";

import { useState } from "react";
import { SELECT_CARET_MUTED, selectCaretStyle } from "./shared";
import { useTaskbook } from "./store";
import type { CategoryOption, CategoryScopeOption } from "./types";

// Which top-bar mode this category's tasks appear under. "Both" (NONE) shows everywhere.
const SCOPE_OPTIONS: { value: CategoryScopeOption; label: string }[] = [
  { value: "NONE", label: "Both" },
  { value: "WORK", label: "Work" },
  { value: "HOME", label: "Home" },
];

export default function CategoryManager({ categoryOptions }: { categoryOptions: CategoryOption[] }) {
  const { actions } = useTaskbook();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    actions.addCategory(name);
  }

  function startEditing(c: CategoryOption) {
    setEditingId(c.id);
    setEditValue(c.name);
  }

  function commitEdit(id: string) {
    const name = editValue.trim();
    setEditingId(null);
    if (!name) return;
    actions.renameCategory(id, name);
  }

  return (
    <div className="rounded-lg border border-(--border-strong) bg-(--card) p-2.5">
      <div className="flex flex-col gap-1.5">
        {categoryOptions.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 text-sm text-(--ink)">
            {editingId === c.id ? (
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitEdit(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEdit(c.id);
                  } else if (e.key === "Escape") {
                    setEditingId(null);
                  }
                }}
                className="w-full min-w-0 rounded-md border border-(--accent-text) px-1.5 py-0.5 text-sm text-(--ink) outline-none"
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEditing(c)}
                  className="cursor-pointer truncate text-left hover:text-(--accent-text)"
                  title="Click to rename"
                >
                  {c.name}
                </button>
                <div className="flex flex-none items-center gap-2.5">
                  <select
                    value={c.scope}
                    onChange={(e) => actions.setCategoryScope(c.id, e.target.value as CategoryScopeOption)}
                    aria-label={`Mode for ${c.name}`}
                    title="Which mode (work/home) this category shows under"
                    className="cursor-pointer rounded-md border border-(--border-strong) bg-transparent px-1 py-0.5 text-[11px] text-(--ink-muted) outline-none"
                    style={selectCaretStyle(SELECT_CARET_MUTED)}
                  >
                    {SCOPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => startEditing(c)}
                    className="cursor-pointer text-xs text-(--info) hover:text-(--accent-text)"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.removeCategory(c.id)}
                    disabled={categoryOptions.length <= 1}
                    className="cursor-pointer text-xs text-(--ink-faint) hover:text-(--danger) disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-(--border-faint) pt-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder="New category"
          className="w-full min-w-0 rounded-md border border-(--border-strong) px-2 py-1 text-sm text-(--ink) outline-none focus:border-(--accent-text)"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="cursor-pointer rounded-md bg-(--accent) px-2.5 py-1 text-xs text-(--on-accent)"
        >
          Add
        </button>
      </div>
    </div>
  );
}
