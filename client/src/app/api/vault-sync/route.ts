import { timingSafeEqual } from "node:crypto";
import { deleteNote, getVaultSnapshot, getVaultVersion, vaultCreateNote, vaultSaveNote } from "@/lib/api";

// The Cura Bridge Obsidian plugin's endpoint (see obsidian-plugin/ and lib/api.ts's vault
// section). A machine caller like api/cron, so it authenticates with a shared bearer secret
// (VAULT_SYNC_SECRET) instead of a Google session and is exempt from the proxy's sign-in redirect.
// No CORS: the plugin uses Obsidian's requestUrl, which isn't subject to it.
//
//   GET  ?only=version  → { version }            the cheap poll (one database operation)
//   GET                 → { version, notes, projects }
//   POST { op: "save", id, body, baseUpdatedAt, title?, projectId? } → { note } | 409 { note }
//   POST { op: "create", id, title, body, projectId }                → { note }
//   POST { op: "delete", id }                                        → {}

function authorized(request: Request) {
  // Same guard as api/cron: an unset secret must never match "Bearer undefined".
  const secret = process.env.VAULT_SYNC_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (new URL(request.url).searchParams.get("only") === "version") {
      return Response.json({ version: await getVaultVersion() });
    }
    return Response.json(await getVaultSnapshot());
  } catch (err) {
    console.error("[vault-sync] read failed:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const id = typeof input.id === "string" && UUID_RE.test(input.id) ? input.id : null;
  if (!id) return Response.json({ error: "Bad id" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const projectId =
    input.projectId === null ? null : typeof input.projectId === "string" && UUID_RE.test(input.projectId) ? input.projectId : undefined;

  try {
    switch (input.op) {
      case "save": {
        const body = str(input.body);
        const baseUpdatedAt = str(input.baseUpdatedAt);
        if (body === undefined || !baseUpdatedAt) return Response.json({ error: "Bad save" }, { status: 400 });
        const result = await vaultSaveNote({ id, body, baseUpdatedAt, title: str(input.title), projectId });
        if (result.status === "missing") return Response.json({ error: "Note not found" }, { status: 404 });
        return Response.json({ note: result.note }, { status: result.status === "conflict" ? 409 : 200 });
      }
      case "create": {
        const note = await vaultCreateNote({
          id,
          title: str(input.title) ?? "Untitled",
          body: str(input.body) ?? "",
          projectId: projectId ?? null,
        });
        return Response.json({ note });
      }
      case "delete":
        await deleteNote(id);
        return Response.json({});
      default:
        return Response.json({ error: "Unknown op" }, { status: 400 });
    }
  } catch (err) {
    console.error("[vault-sync] write failed:", err);
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
