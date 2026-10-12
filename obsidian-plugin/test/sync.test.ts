// End-to-end check of the sync engine against a running Cura (normally the local dev server) and a
// throwaway folder standing in for the vault. Creates notes titled "Bridge test …", and removes them
// again at the end. Needs: CURA_URL (default http://localhost:3001), VAULT_SYNC_SECRET, and
// TEST_PROJECT_ID (any existing project — notes are attached to it, the project itself is untouched).
//
//   VAULT_SYNC_SECRET=… TEST_PROJECT_ID=… npm test

import { mkdtemp, mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { SyncEngine, emptyState, folderFor, noteIdOf, type CuraApi, type VaultFs, type VaultNote } from "../src/core.ts";

const URL_BASE = process.env.CURA_URL ?? "http://localhost:3001";
const TOKEN = process.env.VAULT_SYNC_SECRET ?? "";
const PROJECT_ID = process.env.TEST_PROJECT_ID ?? "";
if (!TOKEN || !PROJECT_ID) throw new Error("Set VAULT_SYNC_SECRET and TEST_PROJECT_ID");

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", label, ok || detail === undefined ? "" : JSON.stringify(detail));
}

async function call(method: string, query: string, body?: unknown) {
  const res = await fetch(`${URL_BASE}/api/vault-sync${query}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const api: CuraApi = {
  version: async () => (await call("GET", "?only=version")).json.version as string,
  snapshot: async () => (await call("GET", "")).json as never,
  save: async (input) => {
    const r = await call("POST", "", { op: "save", ...input });
    if (r.status === 404) return { status: "missing" };
    return { status: r.status === 409 ? "conflict" : "ok", note: r.json.note as VaultNote };
  },
  create: async (input) => (await call("POST", "", { op: "create", ...input })).json.note as VaultNote,
  remove: async (id) => void (await call("POST", "", { op: "delete", id })),
};

const root = await mkdtemp(join(tmpdir(), "cura-vault-"));
const abs = (p: string) => join(root, p);
const fs: VaultFs = {
  list: async (dir) => {
    const out: string[] = [];
    const walk = async (d: string) => {
      let entries;
      try {
        entries = await readdir(abs(d), { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".md")) out.push(p);
      }
    };
    await walk(dir);
    return out;
  },
  read: async (p) => readFile(abs(p), "utf8").catch(() => null),
  write: async (p, c) => {
    await mkdir(dirname(abs(p)), { recursive: true });
    await writeFile(abs(p), c);
  },
  rename: async (from, to) => {
    await mkdir(dirname(abs(to)), { recursive: true });
    await rename(abs(from), abs(to));
  },
  trash: async (p) => {
    await mkdir(abs(".trash"), { recursive: true });
    await rename(abs(p), abs(`.trash/${p.split("/").pop()}`));
  },
  removeEmptyFolder: async (d) => {
    try {
      if ((await readdir(abs(d))).length === 0) await rmdir(abs(d));
    } catch {
      /* missing */
    }
  },
};

const state = emptyState();
const notices: string[] = [];
const engine = new SyncEngine({ fs, api, state, saveState: async () => {}, notify: (m) => notices.push(m), newId: () => crypto.randomUUID() });
const exists = (p: string) => stat(abs(p)).then(() => true, () => false);
const allFiles = async () => (await fs.list("Projects")).concat(await fs.list("Archives")).map((p) => relative(root, abs(p)));

const created: string[] = [];
try {
  // 1. Notes made in Cura appear in the vault, in the right folders, with frontmatter.
  const unfiled = await api.create({ id: crypto.randomUUID(), title: "Bridge test unfiled", body: "Hello from Cura", projectId: null });
  const filed = await api.create({ id: crypto.randomUUID(), title: "Bridge test: filed?", body: "Plan", projectId: PROJECT_ID });
  created.push(unfiled.id, filed.id);
  await engine.pull();
  const snap = await api.snapshot();
  const filedDir = folderFor(filed, snap.projects);
  const unfiledPath = "Projects/_Unfiled/Bridge test unfiled.md";
  const filedPath = `${filedDir}/Bridge test filed.md`;
  check(await exists(unfiledPath), "unfiled note written to _Unfiled", await allFiles());
  check(await exists(filedPath), "filed note written to its project folder (name made file-safe)", await allFiles());
  const filedText = (await fs.read(filedPath))!;
  check(noteIdOf(filedText) === filed.id && /para-status: active/.test(filedText), "frontmatter carries id and project keys", filedText);

  // 2. An edit in Obsidian goes to Cura; a new checkbox comes back tagged with its block id.
  await fs.write(filedPath, `${filedText}\n- [ ] Bridge test task`);
  await engine.pushFile(filedPath);
  const afterPush = (await fs.read(filedPath))!;
  check(/- \[ \] Bridge test task \^cura-[a-z0-9]+/.test(afterPush), "checkbox line got a block id from Cura", afterPush);
  const serverFiled = (await api.snapshot()).notes.find((n) => n.id === filed.id)!;
  check(serverFiled.body.includes("Bridge test task ^cura-"), "Cura stored the edit", serverFiled.body);

  // 3. An edit in Cura reaches the file on the next poll.
  await api.save({ id: unfiled.id, body: "Edited in Cura", baseUpdatedAt: state.notes[unfiled.id].updatedAt });
  check((await engine.pollIfChanged()) === true, "poll notices Cura changed");
  check((await fs.read(unfiledPath))!.endsWith("\nEdited in Cura"), "file updated from Cura", await fs.read(unfiledPath));
  check((await engine.pollIfChanged()) === false, "second poll is a no-op (one cheap version check)");

  // 4. Both sides edited: Cura's wins the file, Obsidian's is kept as a conflict copy.
  const fresh = (await fs.read(unfiledPath))!;
  await fs.write(unfiledPath, fresh.replace("Edited in Cura", "Edited in Obsidian"));
  await api.save({ id: unfiled.id, body: "Edited in Cura again", baseUpdatedAt: state.notes[unfiled.id].updatedAt });
  await engine.pull();
  const conflictCopies = (await fs.list("Projects/_Unfiled")).filter((p) => p.includes("(conflict"));
  check(conflictCopies.length === 1, "conflict copy created", await allFiles());
  check((await fs.read(conflictCopies[0] ?? ""))?.includes("Edited in Obsidian") === true, "conflict copy holds the Obsidian text");
  check((await fs.read(unfiledPath))!.endsWith("Edited in Cura again"), "main file holds Cura's text");
  check(notices.some((n) => n.includes("changed in both places")), "you're told about the conflict", notices);
  await rm(abs(conflictCopies[0]));

  // 5. Renaming the file renames the note.
  const renamedPath = "Projects/_Unfiled/Bridge test renamed.md";
  await fs.rename(unfiledPath, renamedPath);
  await engine.renamed(unfiledPath, renamedPath);
  check((await api.snapshot()).notes.find((n) => n.id === unfiled.id)?.title === "Bridge test renamed", "rename in Obsidian renames the note in Cura");

  // 6. Moving the file into a project folder attaches the note to that project.
  const movedPath = `${filedDir}/Bridge test renamed.md`;
  await fs.rename(renamedPath, movedPath);
  await engine.renamed(renamedPath, movedPath);
  check((await api.snapshot()).notes.find((n) => n.id === unfiled.id)?.projectId === PROJECT_ID, "moving into a project folder sets the project");

  // 7. A new file started in a Cura folder becomes a Cura note.
  await fs.write("Projects/_Unfiled/Bridge test from Obsidian.md", "Started in Obsidian");
  await engine.pull();
  const imported = (await api.snapshot()).notes.find((n) => n.title === "Bridge test from Obsidian");
  if (imported) created.push(imported.id);
  check(imported?.body === "Started in Obsidian", "new file imported as a note", imported);
  check(noteIdOf((await fs.read("Projects/_Unfiled/Bridge test from Obsidian.md"))!) === imported?.id, "imported file now carries its id");

  // 8. Deleted in Cura: the file goes to the trash. Deleted in Obsidian: the note goes.
  await api.remove(imported!.id);
  await engine.pull();
  check(!(await exists("Projects/_Unfiled/Bridge test from Obsidian.md")) && (await exists(".trash/Bridge test from Obsidian.md")), "note deleted in Cura → file trashed");
  const movedNow = state.notes[unfiled.id].path;
  await rm(abs(movedNow));
  await engine.deleted(movedNow);
  check(!(await api.snapshot()).notes.some((n) => n.id === unfiled.id), "file deleted in Obsidian → note deleted in Cura");

  // 9. Files that aren't Cura's are never touched.
  await fs.write("Projects/Appraisal/Appraisal 2026-27.md", "# Mine");
  await engine.pull();
  check((await fs.read("Projects/Appraisal/Appraisal 2026-27.md")) === "# Mine", "unrelated vault files left alone");
} finally {
  for (const id of created) await api.remove(id).catch(() => {});
  await rm(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : "\nall passed");
  process.exitCode = failures ? 1 : 0;
}
