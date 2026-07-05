"use client";

import { useState } from "react";
import { useTaskbook } from "./store";
import type { CategoryOption } from "./types";

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
    <div className="rounded-lg border border-[#d3c9b3] bg-[#faf7ef] p-2.5">
      <div className="flex flex-col gap-1.5">
        {categoryOptions.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 text-sm text-[#2a2622]">
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
                className="w-full min-w-0 rounded-md border border-[#17399b] px-1.5 py-0.5 text-sm text-[#2a2622] outline-none"
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startEditing(c)}
                  className="cursor-pointer truncate text-left hover:text-[#17399b]"
                  title="Click to rename"
                >
                  {c.name}
                </button>
                <div className="flex flex-none items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => startEditing(c)}
                    className="cursor-pointer text-xs text-[#557694] hover:text-[#17399b]"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.removeCategory(c.id)}
                    disabled={categoryOptions.length <= 1}
                    className="cursor-pointer text-xs text-[#b3a988] hover:text-[#8a4040] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 border-t border-[#eee5d4] pt-2">
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
          className="w-full min-w-0 rounded-md border border-[#d3c9b3] px-2 py-1 text-sm text-[#2a2622] outline-none focus:border-[#17399b]"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="cursor-pointer rounded-md bg-[#17399b] px-2.5 py-1 text-xs text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}
