"use client";

// IndexedDB persistence for offline mode — no dependencies, two object stores:
//   kv:     the latest raw-state snapshot (+ the temp→real id map, which must survive a
//           reload while creates are still queued)
//   outbox: the durable, ordered mutation queue (auto-incrementing key = flush order)
//
// IndexedDB uses the structured-clone algorithm, so Date fields inside the raw state
// round-trip as real Dates — no serialization layer needed for the snapshot.

const DB_NAME = "cura-offline";
const DB_VERSION = 1;

export type QueuedOp = {
  seq?: number; // assigned by IndexedDB on add
  action: string; // key into the store's action registry
  // Arguments, serialized: plain strings/numbers/booleans pass through; FormData is flattened
  // to { __fd: [name, value][] } (files never appear in this app's action payloads).
  args: SerializedArg[];
  // For creates: the optimistic temp id whose real id the server will return.
  tempId?: string;
};

export type SerializedArg = string | number | boolean | null | { __fd: [string, string][] };

export function serializeArg(arg: string | number | boolean | null | FormData): SerializedArg {
  if (arg instanceof FormData) {
    const entries: [string, string][] = [];
    arg.forEach((value, key) => entries.push([key, String(value)]));
    return { __fd: entries };
  }
  return arg;
}

export function deserializeArg(arg: SerializedArg): string | number | boolean | null | FormData {
  if (arg && typeof arg === "object" && "__fd" in arg) {
    const fd = new FormData();
    for (const [key, value] of arg.__fd) fd.append(key, value);
    return fd;
  }
  return arg;
}

// Rewrites any temp ids inside an op's args to their now-known real ids — a queued
// "add subtask to tmp-123" must target the real parent once the parent's create has flushed.
export function remapArgIds(args: SerializedArg[], idMap: Record<string, string>): SerializedArg[] {
  const remap = (value: string) => idMap[value] ?? value;
  return args.map((arg) => {
    if (typeof arg === "string") return remap(arg);
    if (arg && typeof arg === "object" && "__fd" in arg) {
      return { __fd: arg.__fd.map(([k, v]) => [k, remap(v)] as [string, string]) };
    }
    return arg;
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const tx = (await db()).transaction("kv", "readonly");
  return reqResult(tx.objectStore("kv").get(key) as IDBRequest<T | undefined>);
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const tx = (await db()).transaction("kv", "readwrite");
  tx.objectStore("kv").put(value, key);
  await txDone(tx);
}

export async function outboxAdd(op: QueuedOp): Promise<void> {
  const tx = (await db()).transaction("outbox", "readwrite");
  tx.objectStore("outbox").add(op);
  await txDone(tx);
}

export async function outboxPeek(): Promise<QueuedOp | undefined> {
  const tx = (await db()).transaction("outbox", "readonly");
  const cursor = await reqResult(tx.objectStore("outbox").openCursor());
  return cursor?.value as QueuedOp | undefined;
}

export async function outboxDelete(seq: number): Promise<void> {
  const tx = (await db()).transaction("outbox", "readwrite");
  tx.objectStore("outbox").delete(seq);
  await txDone(tx);
}

export async function outboxCount(): Promise<number> {
  const tx = (await db()).transaction("outbox", "readonly");
  return reqResult(tx.objectStore("outbox").count());
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

// A server action that failed because the network is down looks different from one the server
// rejected: fetch aborts reject with a TypeError before any response exists.
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return err instanceof TypeError;
}
