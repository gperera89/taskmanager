// Cura bridge — the Obsidian side. Wires the sync engine (core.ts) to the vault and to Cura's
// api/vault-sync endpoint. Desktop-only on purpose: one Mac does the syncing, and Obsidian Sync
// carries the files to every other device. Two copies of this plugin syncing the same vault would
// race each other over the same files.

import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, requestUrl } from "obsidian";
import {
  ARCHIVES_DIR,
  PROJECTS_DIR,
  SyncEngine,
  emptyState,
  type CuraApi,
  type SyncState,
  type VaultFs,
  type VaultNote,
} from "./core";

type Settings = {
  serverUrl: string; // e.g. https://cura.example.com — no trailing slash needed
  token: string; // VAULT_SYNC_SECRET
  intervalMinutes: number;
  lastRun: string;
  lastResult: string;
};

const DEFAULTS: Settings = { serverUrl: "", token: "", intervalMinutes: 5, lastRun: "", lastResult: "" };

// Edits are pushed once typing has paused this long — each push is a few database operations on
// Cura's metered free tier, so it shouldn't happen on every keystroke.
const PUSH_DEBOUNCE_MS = 2500;
// Window focus triggers a version check, but not more often than this.
const FOCUS_THROTTLE_MS = 30_000;

export default class CuraBridge extends Plugin {
  settings: Settings = { ...DEFAULTS };
  syncState: SyncState = emptyState();
  engine!: SyncEngine;
  private pushTimers = new Map<string, number>();
  private lastFocusPoll = 0;

  async onload() {
    const data = (await this.loadData()) as (Partial<Settings> & { sync?: SyncState }) | null;
    this.settings = { ...DEFAULTS, ...(data ?? {}) };
    this.syncState = { ...emptyState(), ...(data?.sync ?? {}) };

    this.engine = new SyncEngine({
      fs: this.vaultFs(),
      api: this.curaApi(),
      state: this.syncState,
      saveState: () => this.persist(),
      notify: (message) => new Notice(message, 10_000),
      newId: () => crypto.randomUUID(),
    });

    this.addSettingTab(new CuraBridgeSettings(this.app, this));
    this.addCommand({ id: "sync-now", name: "Sync with Cura now", callback: () => void this.run(true) });

    // Vault events only after the vault has loaded — before that, Obsidian reports every existing
    // file as "created".
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("modify", (f) => this.onChanged(f.path)));
      this.registerEvent(this.app.vault.on("create", (f) => this.onChanged(f.path)));
      this.registerEvent(
        this.app.vault.on("rename", (f, oldPath) => {
          if (!isManaged(f.path) && !isManaged(oldPath)) return;
          void this.guard(() => this.engine.renamed(oldPath, f.path));
        })
      );
      this.registerEvent(
        this.app.vault.on("delete", (f) => {
          if (f instanceof TFile && isManaged(f.path)) void this.guard(() => this.engine.deleted(f.path));
        })
      );
      this.registerDomEvent(window, "focus", () => {
        if (Date.now() - this.lastFocusPoll < FOCUS_THROTTLE_MS) return;
        this.lastFocusPoll = Date.now();
        void this.run(false);
      });
      this.registerInterval(window.setInterval(() => void this.run(false), Math.max(1, this.settings.intervalMinutes) * 60_000));
      void this.run(false);
    });
  }

  onunload() {
    for (const t of this.pushTimers.values()) window.clearTimeout(t);
  }

  private onChanged(path: string) {
    if (!path.endsWith(".md") || !isManaged(path)) return;
    const existing = this.pushTimers.get(path);
    if (existing) window.clearTimeout(existing);
    this.pushTimers.set(
      path,
      window.setTimeout(() => {
        this.pushTimers.delete(path);
        void this.guard(() => this.engine.pushFile(path));
      }, PUSH_DEBOUNCE_MS)
    );
  }

  // A version check, and a pull when Cura has changed. `manual` forces the pull and reports back.
  async run(manual: boolean) {
    if (!this.configured()) {
      if (manual) new Notice("Cura bridge: set the server URL and token in the plugin's settings first.");
      return;
    }
    await this.guard(async () => {
      if (manual) await this.engine.pull();
      else await this.engine.pollIfChanged();
      this.settings.lastResult = `OK — ${Object.keys(this.syncState.notes).length} notes`;
      if (manual) new Notice(`Cura bridge: synced ${Object.keys(this.syncState.notes).length} notes.`);
    }, manual);
  }

  private async guard(fn: () => Promise<void>, loud = false) {
    if (!this.configured()) return;
    try {
      await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[cura-bridge]", err);
      this.settings.lastResult = `Error: ${message}`;
      if (loud) new Notice(`Cura bridge: ${message}`, 10_000);
    } finally {
      this.settings.lastRun = new Date().toISOString();
      await this.persist();
    }
  }

  private configured() {
    return !!this.settings.serverUrl && !!this.settings.token;
  }

  async persist() {
    await this.saveData({ ...this.settings, sync: this.syncState });
  }

  // --- Cura's endpoint ---

  private curaApi(): CuraApi {
    const call = async (method: "GET" | "POST", query: string, body?: unknown) => {
      const res = await requestUrl({
        url: `${this.settings.serverUrl.replace(/\/+$/, "")}/api/vault-sync${query}`,
        method,
        headers: { Authorization: `Bearer ${this.settings.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        throw: false,
      });
      if (res.status === 401) throw new Error("Cura rejected the token (check VAULT_SYNC_SECRET).");
      return res;
    };
    const ok = (res: { status: number; json: unknown }) => {
      if (res.status >= 400) throw new Error(`Cura answered ${res.status}`);
      return res.json as Record<string, unknown>;
    };
    return {
      version: async () => ok(await call("GET", "?only=version")).version as string,
      snapshot: async () => ok(await call("GET", "")) as never,
      save: async (input) => {
        const res = await call("POST", "", { op: "save", ...input });
        if (res.status === 404) return { status: "missing" };
        if (res.status === 409) return { status: "conflict", note: (res.json as { note: VaultNote }).note };
        return { status: "ok", note: ok(res).note as VaultNote };
      },
      create: async (input) => ok(await call("POST", "", { op: "create", ...input })).note as VaultNote,
      remove: async (id) => {
        ok(await call("POST", "", { op: "delete", id }));
      },
    };
  }

  // --- The vault ---

  private vaultFs(): VaultFs {
    const vault = this.app.vault;
    const fileAt = (path: string) => {
      const f = vault.getAbstractFileByPath(normalizePath(path));
      return f instanceof TFile ? f : null;
    };
    const ensureFolder = async (dir: string) => {
      if (!dir) return;
      const parts = normalizePath(dir).split("/");
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join("/");
        if (!vault.getAbstractFileByPath(sub)) await vault.createFolder(sub);
      }
    };
    const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
    return {
      list: async (dir) => {
        const root = vault.getAbstractFileByPath(normalizePath(dir));
        if (!(root instanceof TFolder)) return [];
        const out: string[] = [];
        const walk = (folder: TFolder) => {
          for (const child of folder.children) {
            if (child instanceof TFolder) walk(child);
            else if (child instanceof TFile && child.extension === "md") out.push(child.path);
          }
        };
        walk(root);
        return out;
      },
      read: async (path) => {
        const f = fileAt(path);
        return f ? vault.read(f) : null;
      },
      write: async (path, content) => {
        const f = fileAt(path);
        if (f) await vault.process(f, () => content);
        else {
          await ensureFolder(parent(path));
          await vault.create(normalizePath(path), content);
        }
      },
      rename: async (from, to) => {
        const f = fileAt(from);
        if (!f) return;
        await ensureFolder(parent(to));
        // fileManager (not vault) so links to the note elsewhere in the vault follow it.
        await this.app.fileManager.renameFile(f, normalizePath(to));
      },
      trash: async (path) => {
        const f = fileAt(path);
        if (f) await vault.trash(f, false);
      },
      removeEmptyFolder: async (dir) => {
        const folder = vault.getAbstractFileByPath(normalizePath(dir));
        if (folder instanceof TFolder && folder.children.length === 0) await vault.delete(folder);
      },
    };
  }
}

function isManaged(path: string) {
  return path.startsWith(`${PROJECTS_DIR}/`) || path.startsWith(`${ARCHIVES_DIR}/`);
}

class CuraBridgeSettings extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CuraBridge) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    new Setting(containerEl)
      .setName("Cura address")
      .setDesc("Where Cura is hosted, e.g. https://your-cura-domain")
      .addText((t) =>
        t.setValue(s.serverUrl).onChange(async (v) => {
          s.serverUrl = v.trim();
          await this.plugin.persist();
        })
      );
    new Setting(containerEl)
      .setName("Token")
      .setDesc("Cura's VAULT_SYNC_SECRET")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setValue(s.token).onChange(async (v) => {
          s.token = v.trim();
          await this.plugin.persist();
        });
      });
    new Setting(containerEl)
      .setName("Check every (minutes)")
      .setDesc("How often to ask Cura whether anything changed. Takes effect after a restart.")
      .addText((t) =>
        t.setValue(String(s.intervalMinutes)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 1) {
            s.intervalMinutes = Math.round(n);
            await this.plugin.persist();
          }
        })
      );
    new Setting(containerEl)
      .setName("Sync now")
      .setDesc(s.lastRun ? `Last run ${new Date(s.lastRun).toLocaleString()} — ${s.lastResult}` : "Not run yet")
      .addButton((b) =>
        b.setButtonText("Sync").onClick(async () => {
          await this.plugin.run(true);
          this.display();
        })
      );
  }
}
