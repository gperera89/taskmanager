// Client-safe (no "server-only"): the checkbox ↔ task link between a note's Markdown and Cura's
// tasks. Shared by the server (api.ts's note save — the authoritative path, and the one the
// Obsidian bridge will use) and the optimistic store (store.tsx), so both read a note the same way.
//
// A checkbox line (`- [ ] buy filament`) becomes a task. The line is tagged with an Obsidian block
// id — `- [ ] buy filament ^cura-k3x9q2` — which is how the line and its task find each other
// again after edits, moves and reorders. The id is stored on the task (Task.noteBlockId) and
// hidden in Cura's editor; Obsidian shows it faintly at the end of the line.

export const BLOCK_ID_PREFIX = "cura-";
const BLOCK_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

const CHECKBOX_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s?)(.*)$/;
// A block id token anywhere in the line. It belongs at the end, but text typed after it (the
// caret lands past the hidden id at the end of a line in Cura's editor) pushes it inward —
// so it's found wherever it sits, and assignBlockIds moves it back to the end.
const BLOCK_ID_TOKEN_RE = /\s*\^cura-([a-z0-9]+)(?=\s|$)/g;
const FENCE_RE = /^\s*(```|~~~)/;

export function newBlockId(): string {
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) id += BLOCK_ID_ALPHABET[b % BLOCK_ID_ALPHABET.length];
  return id;
}

export type CheckboxLine = {
  lineIndex: number;
  checked: boolean;
  title: string; // the line's text, block id stripped, trimmed
  blockId: string | null;
};

// Every checkbox line in the note, outside frontmatter and fenced code blocks.
export function parseCheckboxLines(body: string): CheckboxLine[] {
  const lines = body.split("\n");
  const out: CheckboxLine[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = CHECKBOX_RE.exec(line);
    if (!m) continue;
    const { text, ids } = splitBlockIds(m[4]);
    out.push({ lineIndex: i, checked: m[2] !== " ", title: text, blockId: ids[0] ?? null });
  }
  return out;
}

// A checkbox line's text with every block id token taken out (normally there's one, at the end).
function splitBlockIds(rest: string): { text: string; ids: string[] } {
  const ids: string[] = [];
  const text = rest.replace(BLOCK_ID_TOKEN_RE, (_m, id: string) => {
    ids.push(id);
    return "";
  });
  return { text: text.trim(), ids };
}

function withBlockId(prefix: string, text: string, id: string): string {
  return `${prefix}${text} ^${BLOCK_ID_PREFIX}${id}`;
}

export function hasCheckboxLines(body: string): boolean {
  return parseCheckboxLines(body).length > 0;
}

// Tags every checkbox line that has text but no id (or a duplicate of an earlier line's id — a
// copied line) with a fresh block id, and puts every id back at the end of its line. Empty
// checkboxes are left alone until something is typed. Returns the body unchanged (same string)
// when nothing needed doing.
export function assignBlockIds(body: string, mint: () => string = newBlockId): string {
  const lines = body.split("\n");
  const seen = new Set<string>();
  let changed = false;
  for (const cb of parseCheckboxLines(body)) {
    let id = cb.blockId;
    if (!id || seen.has(id)) {
      if (!cb.title) continue;
      id = mint();
      while (seen.has(id)) id = mint();
    }
    seen.add(id);
    const m = CHECKBOX_RE.exec(lines[cb.lineIndex])!;
    const next = withBlockId(`${m[1]}${m[2]}${m[3]}`, cb.title, id);
    if (next !== lines[cb.lineIndex]) {
      lines[cb.lineIndex] = next;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : body;
}

// --- Planning a sync between a note body and the tasks linked to it ---

export type LinkedTask = { id: string; noteBlockId: string | null; title: string; isCompleted: boolean };

export type NoteTaskPlan = {
  creates: { blockId: string; title: string; checked: boolean }[];
  // Title and/or completion changed on the note side. `toggle` mirrors toggleTaskCompletion's
  // argument: the task's *current* state, which the toggle flips.
  renames: { taskId: string; title: string }[];
  toggles: { taskId: string; isCompleted: boolean }[];
  // Linked tasks whose line is gone from the note. Never deleted by the sync itself — the caller
  // decides (the app asks first; see store.tsx's saveNoteBody).
  orphans: string[];
};

// Expects a body that has already been through assignBlockIds.
export function planNoteTaskSync(body: string, linked: LinkedTask[]): NoteTaskPlan {
  const plan: NoteTaskPlan = { creates: [], renames: [], toggles: [], orphans: [] };
  const byBlock = new Map(linked.filter((t) => t.noteBlockId).map((t) => [t.noteBlockId!, t]));
  const present = new Set<string>();
  for (const cb of parseCheckboxLines(body)) {
    if (!cb.blockId || !cb.title || present.has(cb.blockId)) continue;
    present.add(cb.blockId);
    const task = byBlock.get(cb.blockId);
    if (!task) {
      plan.creates.push({ blockId: cb.blockId, title: cb.title, checked: cb.checked });
      continue;
    }
    if (task.title !== cb.title) plan.renames.push({ taskId: task.id, title: cb.title });
    if (task.isCompleted !== cb.checked) plan.toggles.push({ taskId: task.id, isCompleted: task.isCompleted });
  }
  for (const t of linked) {
    if (!t.noteBlockId || !present.has(t.noteBlockId)) plan.orphans.push(t.id);
  }
  return plan;
}

export function bodyHasBlock(body: string, blockId: string): boolean {
  return parseCheckboxLines(body).some((cb) => cb.blockId === blockId);
}

// --- Editing a note from the task side (a tick, rename or delete made elsewhere in Cura) ---

function editBlockLine(body: string, blockId: string, edit: (line: string, m: RegExpExecArray) => string | null): string {
  const target = parseCheckboxLines(body).find((cb) => cb.blockId === blockId);
  if (!target) return body;
  const lines = body.split("\n");
  const m = CHECKBOX_RE.exec(lines[target.lineIndex])!;
  const next = edit(lines[target.lineIndex], m);
  if (next === null) lines.splice(target.lineIndex, 1);
  else lines[target.lineIndex] = next;
  return lines.join("\n");
}

export function setBlockChecked(body: string, blockId: string, checked: boolean): string {
  return editBlockLine(body, blockId, (_line, m) => `${m[1]}${checked ? "x" : " "}${m[3]}${m[4]}`);
}

export function setBlockTitle(body: string, blockId: string, title: string): string {
  return editBlockLine(body, blockId, (_line, m) => withBlockId(`${m[1]}${m[2]}${m[3]}`, title.trim(), blockId));
}

export function removeBlockLine(body: string, blockId: string): string {
  return editBlockLine(body, blockId, () => null);
}

// --- Category for tasks a note creates ---

// Task.category is required. A note's tasks take the category most used in its project, falling
// back to the first category (the same default the project card's "+ Add task" uses).
export function defaultNoteTaskCategory(projectTaskCategories: string[], categoryNames: string[]): string {
  const counts = new Map<string, number>();
  for (const c of projectTaskCategories) counts.set(c, (counts.get(c) ?? 0) + 1);
  let best: string | null = null;
  for (const [c, n] of counts) if (best === null || n > counts.get(best)!) best = c;
  return best ?? categoryNames[0] ?? "Work";
}

// --- Minimal edit between two versions of a doc, for patching a live editor ---

// When the note changes from outside the editor (a tick in the side panel, block ids being
// assigned), the editor applies only the lines that differ rather than replacing the whole doc,
// so the caret and scroll stay where they were. Same line count → one change per differing line
// (trimmed to the differing span); otherwise one change covering the differing middle.
export function diffChanges(prev: string, next: string): { from: number; to: number; insert: string }[] {
  if (prev === next) return [];
  const a = prev.split("\n");
  const b = next.split("\n");
  if (a.length === b.length) {
    const changes: { from: number; to: number; insert: string }[] = [];
    let offset = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) changes.push(spanChange(a[i], b[i], offset));
      offset += a[i].length + 1;
    }
    return changes;
  }
  return [spanChange(prev, next, 0)];
}

function spanChange(a: string, b: string, offset: number) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: offset + start, to: offset + endA, insert: b.slice(start, endB) };
}
