// The sync engine, kept free of Obsidian imports so it can be exercised against a plain folder
// (see test/sync.test.ts). main.ts supplies a VaultFs over Obsidian's vault API.
//
// Cura is the source of truth for every note; this keeps a Markdown file per note in the vault:
//
//   Projects/Project — <Name> <YYYY-MM>/<Title>.md   notes in an active project
//   Archives/Project — <Name> <YYYY-MM>/<Title>.md   notes in a completed project
//   Projects/_Unfiled/<Title>.md                     notes with no project
//
// A file is tied to its note by `cura-note: <id>` in its frontmatter, never by its path, so a
// rename or move can't lose track of it. Only files carrying that key are ever touched — plus new
// files you start inside one of the folders above, which become new Cura notes.

export const PROJECTS_DIR = "Projects";
export const ARCHIVES_DIR = "Archives";
export const UNFILED_DIR = `${PROJECTS_DIR}/_Unfiled`;

export type VaultNote = { id: string; title: string; body: string; projectId: string | null; updatedAt: string };
export type VaultProject = { id: string; name: string; dueDate: string | null; isCompleted: boolean };
export type Snapshot = { version: string; notes: VaultNote[]; projects: VaultProject[] };

export interface CuraApi {
  version(): Promise<string>;
  snapshot(): Promise<Snapshot>;
  save(input: { id: string; body: string; baseUpdatedAt: string; title?: string; projectId?: string | null }): Promise<
    { status: "ok" | "conflict"; note: VaultNote } | { status: "missing" }
  >;
  create(input: { id: string; title: string; body: string; projectId: string | null }): Promise<VaultNote>;
  remove(id: string): Promise<void>;
}

export interface VaultFs {
  list(dir: string): Promise<string[]>; // every .md path under dir, recursively ([] if missing)
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>; // creates parent folders as needed
  rename(from: string, to: string): Promise<void>; // creates parent folders as needed
  trash(path: string): Promise<void>; // recoverable delete (Obsidian's .trash)
  removeEmptyFolder(dir: string): Promise<void>; // no-op unless the folder exists and is empty
}

export type NoteRecord = { path: string; hash: string; updatedAt: string };
export type SyncState = {
  lastVersion: string;
  notes: Record<string, NoteRecord>;
  projects: VaultProject[]; // from the last snapshot — matches folders to projects on a move
};

export const emptyState = (): SyncState => ({ lastVersion: "", notes: {}, projects: [] });

// --- Files ---------------------------------------------------------------------------------------

// Characters Obsidian won't take in a file name (or that break links), plus leading dots.
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "Untitled";
}

export function projectFolderName(p: VaultProject): string {
  // The vault's naming convention (Projects/README.md): "Project — <Name> <YYYY-MM>".
  const month = p.dueDate ? ` ${p.dueDate.slice(0, 7)}` : "";
  return `Project — ${safeFileName(p.name)}${month}`;
}

export function folderFor(note: { projectId: string | null }, projects: VaultProject[]): string {
  const project = note.projectId ? projects.find((p) => p.id === note.projectId) : undefined;
  if (!project) return UNFILED_DIR;
  return `${project.isCompleted ? ARCHIVES_DIR : PROJECTS_DIR}/${projectFolderName(project)}`;
}

export function parentOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}

// Whether a file name is this title's — exactly, or with the " (2)" a name clash adds.
export function nameFits(fileBase: string, title: string): boolean {
  const want = safeFileName(title);
  if (fileBase === want || !fileBase.startsWith(`${want} (`)) return fileBase === want;
  return /^ \(\d+\)$/.test(fileBase.slice(want.length));
}

// Which project a folder stands for: null for _Unfiled, a project id, or undefined when the
// folder isn't one this plugin manages (anything else in the vault).
export function projectForFolder(dir: string, projects: VaultProject[]): string | null | undefined {
  if (dir === UNFILED_DIR) return null;
  const match = projects.find((p) => folderFor({ projectId: p.id }, projects) === dir);
  return match ? match.id : undefined;
}

// --- Frontmatter ---------------------------------------------------------------------------------

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

// The note's body with the frontmatter block taken off, and the frontmatter's top-level entries
// in order (each with any indented continuation lines, so lists and nested values survive).
export function splitFile(content: string): { entries: { key: string; text: string }[]; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  const m = FM_RE.exec(normalized);
  if (!m) return { entries: [], body: normalized };
  const entries: { key: string; text: string }[] = [];
  for (const line of m[1].split("\n")) {
    const key = /^([A-Za-z0-9_-]+):/.exec(line);
    if (key) entries.push({ key: key[1], text: line });
    else if (entries.length) entries[entries.length - 1].text += `\n${line}`;
  }
  return { entries, body: normalized.slice(m[0].length) };
}

export function noteIdOf(content: string): string | null {
  const entry = splitFile(content).entries.find((e) => e.key === "cura-note");
  const id = entry?.text.slice("cura-note:".length).trim().replace(/^["']|["']$/g, "");
  return id || null;
}

const MANAGED_KEYS = ["cura-note", "cura-project", "type", "para", "para-status", "due", "last_updated"];

// The file as it should be written: Cura's keys (and the README's required project-note keys)
// first, then anything you added in Obsidian, kept as it was, then the body.
export function composeFile(note: VaultNote, projects: VaultProject[], existing: string | null): string {
  const project = note.projectId ? projects.find((p) => p.id === note.projectId) : undefined;
  const managed = [
    `cura-note: ${note.id}`,
    ...(project ? [`cura-project: ${project.id}`] : []),
    "type: note",
    ...(project ? ["para: project", `para-status: ${project.isCompleted ? "complete" : "active"}`] : []),
    ...(project?.dueDate ? [`due: ${project.dueDate}`] : []),
    `last_updated: ${note.updatedAt.slice(0, 10)}`,
  ];
  const kept = existing ? splitFile(existing).entries.filter((e) => !MANAGED_KEYS.includes(e.key)).map((e) => e.text) : [];
  return `---\n${[...managed, ...kept].join("\n")}\n---\n${note.body}`;
}

// FNV-1a over the body — what "edited since the last sync" is judged on. Frontmatter is left out
// on purpose (adding a tag in Obsidian isn't an edit to send to Cura), and so is the title: a
// title change shows up as the file name differing from the one recorded at the last sync.
export function contentHash(body: string): string {
  let h = 0x811c9dc5;
  const s = body;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// --- The engine ----------------------------------------------------------------------------------

export type SyncDeps = {
  fs: VaultFs;
  api: CuraApi;
  state: SyncState;
  saveState: (state: SyncState) => Promise<void>;
  notify: (message: string) => void;
  newId: () => string;
};

export class SyncEngine {
  // Nothing needs to recognise the vault events the engine's own writes cause: operations run one
  // at a time (so by the time such an event is handled, the state already records the new path),
  // and a push of unchanged text is a no-op by its hash.
  private writesToCura = 0;
  private running: Promise<void> = Promise.resolve();

  private readonly deps: SyncDeps;

  constructor(deps: SyncDeps) {
    this.deps = deps;
  }

  get state() {
    return this.deps.state;
  }

  // Every operation runs one at a time — a pull and a push racing over the same file would each
  // see the other's half-finished work.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.running.then(fn, fn);
    this.running = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  // A free path for `title` in `dir`, skipping files that belong to other notes.
  private freePath(dir: string, title: string, taken: Set<string>, selfPath?: string): string {
    const base = safeFileName(title);
    for (let n = 1; ; n++) {
      const candidate = `${dir}/${n === 1 ? base : `${base} (${n})`}.md`;
      if (candidate === selfPath || !taken.has(candidate)) return candidate;
    }
  }

  // Finds every file that carries a cura-note id, wherever it has been moved to.
  private async scan(): Promise<Map<string, { path: string; content: string }>> {
    const found = new Map<string, { path: string; content: string }>();
    // Known locations first (cheap and usually right), then the managed trees.
    const paths = new Set<string>(Object.values(this.state.notes).map((r) => r.path));
    for (const dir of [PROJECTS_DIR, ARCHIVES_DIR]) for (const p of await this.deps.fs.list(dir)) paths.add(p);
    for (const path of paths) {
      const content = await this.deps.fs.read(path);
      if (content === null) continue;
      const id = noteIdOf(content);
      if (id && !found.has(id)) found.set(id, { path, content });
    }
    return found;
  }

  // The cheap check: only pulls when Cura's notes or projects have changed since last time.
  pollIfChanged(): Promise<boolean> {
    return this.serial(async () => {
      const version = await this.deps.api.version();
      if (version === this.state.lastVersion) return false;
      await this.pullNow();
      return true;
    });
  }

  pull(): Promise<void> {
    return this.serial(() => this.pullNow());
  }

  private async pullNow() {
    const { api, fs, notify } = this.deps;
    const snap = await api.snapshot();
    const state = this.state;
    state.projects = snap.projects;
    const local = await this.scan();
    const taken = new Set<string>([...local.values()].map((l) => l.path));
    const serverIds = new Set(snap.notes.map((n) => n.id));
    const touchedDirs = new Set<string>();
    const countBefore = this.writesToCura;

    for (const note of snap.notes) {
      const rec = state.notes[note.id];
      const file = local.get(note.id);
      const dir = folderFor(note, snap.projects);
      let current = note;

      if (file) {
        const { body } = splitFile(file.content);
        const renamedHere = !!rec && baseName(rec.path) !== baseName(file.path);
        const localChanged = rec ? contentHash(body) !== rec.hash || renamedHere : contentHash(body) !== contentHash(note.body);
        const serverChanged = !rec || rec.updatedAt !== note.updatedAt;

        if (localChanged && !serverChanged && rec) {
          // Edited in Obsidian while the plugin wasn't watching — send it now.
          const pushed = await this.pushContent(note.id, file.path, file.content, rec);
          if (pushed) current = pushed;
        } else if (localChanged && serverChanged) {
          // Both sides changed: Cura's version takes the file, Obsidian's is kept beside it.
          const copy = this.freePath(parentOf(file.path), `${baseName(file.path)} (conflict ${today()})`, taken);
          taken.add(copy);
          await this.deps.fs.write(copy, body);
          notify(`Cura: "${note.title}" changed in both places — your Obsidian version is in "${baseName(copy)}".`);
        }

        // Where it should live (its project's folder, named for its title), and with what content.
        let path = file.path;
        if (parentOf(path) !== dir || !nameFits(baseName(path), current.title)) {
          taken.delete(path);
          const target = this.freePath(dir, current.title, taken);
          if (target !== path) {
            touchedDirs.add(parentOf(path));
            await this.deps.fs.rename(path, target);
            path = target;
          }
        }
        taken.add(path);
        const existing = await fs.read(path);
        const composed = composeFile(current, snap.projects, existing);
        if (composed !== existing) await this.deps.fs.write(path, composed);
        state.notes[note.id] = { path, hash: contentHash(current.body), updatedAt: current.updatedAt };
        continue;
      }

      if (rec && rec.updatedAt === note.updatedAt) {
        // The file was deleted in Obsidian while the plugin wasn't running. Deleting it is the
        // intent, so it carries through (the note's tasks stay in Cura as ordinary tasks).
        await api.remove(note.id);
        this.writesToCura++;
        delete state.notes[note.id];
        notify(`Cura: deleted "${note.title}" (its file was deleted in Obsidian).`);
        continue;
      }

      const path = this.freePath(dir, note.title, taken);
      taken.add(path);
      await this.deps.fs.write(path, composeFile(note, snap.projects, null));
      state.notes[note.id] = { path, hash: contentHash(note.body), updatedAt: note.updatedAt };
    }

    // Deleted in Cura: the file goes to Obsidian's trash (recoverable), not into thin air.
    for (const id of Object.keys(state.notes)) {
      if (serverIds.has(id)) continue;
      const file = local.get(id);
      if (file) {
        touchedDirs.add(parentOf(file.path));
        await fs.trash(file.path);
      }
      delete state.notes[id];
    }

    // New files started in a Cura folder become Cura notes.
    await this.importNew(snap.projects, local);

    for (const dir of touchedDirs) if (dir !== UNFILED_DIR && dir !== PROJECTS_DIR && dir !== ARCHIVES_DIR) await fs.removeEmptyFolder(dir);
    // Anything this pull sent to Cura moved the version on from the snapshot's.
    state.lastVersion = this.writesToCura === countBefore ? snap.version : await api.version();
    await this.deps.saveState(state);
  }

  private async importNew(projects: VaultProject[], local: Map<string, { path: string; content: string }>) {
    const tracked = new Set([...local.values()].map((l) => l.path));
    const dirs = [UNFILED_DIR, ...projects.map((p) => folderFor({ projectId: p.id }, projects))];
    for (const dir of new Set(dirs)) {
      for (const path of await this.deps.fs.list(dir)) {
        if (tracked.has(path) || parentOf(path) !== dir || / \(conflict \d{4}-\d{2}-\d{2}\)/.test(baseName(path))) continue;
        const content = await this.deps.fs.read(path);
        if (content === null || noteIdOf(content)) continue;
        await this.importFile(path, content, projectForFolder(dir, projects) ?? null);
      }
    }
  }

  private async importFile(path: string, content: string, projectId: string | null) {
    const { body } = splitFile(content);
    const note = await this.deps.api.create({ id: this.deps.newId(), title: baseName(path), body, projectId });
    this.writesToCura++;
    await this.deps.fs.write(path, composeFile(note, this.state.projects, content));
    this.state.notes[note.id] = { path, hash: contentHash(note.body), updatedAt: note.updatedAt };
  }

  // A file was edited in Obsidian (debounced by the caller).
  pushFile(path: string): Promise<void> {
    return this.serial(async () => {
      const content = await this.deps.fs.read(path);
      if (content === null) return;
      const id = noteIdOf(content);
      if (!id) {
        // A new file in one of Cura's folders — make it a note.
        const projectId = projectForFolder(parentOf(path), this.state.projects);
        if (projectId !== undefined && !/ \(conflict \d{4}-\d{2}-\d{2}\)/.test(baseName(path))) {
          await this.importFile(path, content, projectId);
          await this.deps.saveState(this.state);
        }
        return;
      }
      const rec = this.state.notes[id];
      if (!rec) return; // not synced yet — the next pull handles it
      const pushed = await this.pushContent(id, path, content, rec);
      if (pushed) await this.deps.saveState(this.state);
    });
  }

  // Sends one file's content to Cura and adopts what comes back (block ids on new checkbox lines).
  // Returns the note as Cura now has it, or null when there was nothing to send.
  private async pushContent(id: string, path: string, content: string, rec: NoteRecord): Promise<VaultNote | null> {
    const { body } = splitFile(content);
    const renamed = baseName(path) !== baseName(rec.path);
    const moved = parentOf(path) !== parentOf(rec.path);
    if (contentHash(body) === rec.hash && !renamed && !moved) return null;

    // A move between Cura folders is a change of project; a rename is a change of title (unless
    // it's only the " (2)" a name clash added).
    const projectId = moved ? projectForFolder(parentOf(path), this.state.projects) : undefined;
    const title = renamed ? baseName(path) : undefined;
    const result = await this.deps.api.save({ id, body, baseUpdatedAt: rec.updatedAt, title, projectId });
    this.writesToCura++;
    if (result.status === "missing") {
      delete this.state.notes[id];
      return null;
    }
    if (result.status === "conflict") {
      const copy = `${parentOf(path)}/${safeFileName(`${baseName(path)} (conflict ${today()})`)}.md`;
      await this.deps.fs.write(copy, body);
      await this.deps.fs.write(path, composeFile(result.note, this.state.projects, content));
      this.state.notes[id] = { path, hash: contentHash(result.note.body), updatedAt: result.note.updatedAt };
      this.deps.notify(`Cura: "${result.note.title}" had changed in Cura — your Obsidian version is in "${baseName(copy)}".`);
      return result.note;
    }
    const note = result.note;
    const composed = composeFile(note, this.state.projects, content);
    if (composed !== content) await this.deps.fs.write(path, composed);
    this.state.notes[id] = { path, hash: contentHash(note.body), updatedAt: note.updatedAt };
    return note;
  }

  // A tracked file was renamed or moved in Obsidian.
  renamed(from: string, to: string): Promise<void> {
    return this.serial(async () => {
      const entry = Object.entries(this.state.notes).find(([, r]) => r.path === from);
      if (!entry) return;
      const [id, rec] = entry;
      const content = await this.deps.fs.read(to);
      if (content === null) return;
      // Moved out of Cura's folders entirely: leave it be; the next pull puts a copy back.
      const projectId = projectForFolder(parentOf(to), this.state.projects);
      if (parentOf(to) !== parentOf(from) && projectId === undefined) return;
      await this.pushContent(id, to, content, rec);
      await this.deps.saveState(this.state);
    });
  }

  // A tracked file was deleted in Obsidian: the note goes too (its tasks stay as ordinary tasks).
  deleted(path: string): Promise<void> {
    return this.serial(async () => {
      const entry = Object.entries(this.state.notes).find(([, r]) => r.path === path);
      if (!entry) return;
      await this.deps.api.remove(entry[0]);
      delete this.state.notes[entry[0]];
      await this.deps.saveState(this.state);
    });
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
