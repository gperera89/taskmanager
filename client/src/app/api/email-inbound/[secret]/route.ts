import {
  createProject,
  createTask,
  createVoiceCaptureNotice,
  getCategories,
} from "@/lib/api";
import { parseEmailToItems, type EmailTask } from "@/lib/email";

// Addresses allowed to file into Cura by email. Overridable via INBOUND_EMAIL_ALLOWED (a
// comma-separated list); falls back to the two known personal/work addresses. Compared
// case-insensitively.
function allowedSenders(): string[] {
  const fromEnv = process.env.INBOUND_EMAIL_ALLOWED;
  const list = fromEnv
    ? fromEnv.split(",")
    : ["g.perera26@gmail.com", "gayan.perera@ycis.com"];
  return list.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// Postmark posts a "just the address" form and a "Name <addr>" form; pull the bare address out.
function extractEmailAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const angled = /<([^>]+)>/.exec(raw);
  const addr = (angled ? angled[1] : raw).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

// Strips a Postmark inbound payload down to sender + subject + best-effort plain-text body.
function readPayload(body: Record<string, unknown>): { from: string | null; subject: string; text: string } {
  const fromFull = body.FromFull as { Email?: unknown } | undefined;
  const from = extractEmailAddress(fromFull?.Email) ?? extractEmailAddress(body.From);
  const subject = typeof body.Subject === "string" ? body.Subject : "";
  // Prefer the plain-text body; fall back to a crude tag-strip of the HTML if that's all there is.
  let text = typeof body.TextBody === "string" ? body.TextBody : "";
  if (!text.trim() && typeof body.HtmlBody === "string") {
    text = body.HtmlBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return { from, subject, text };
}

async function handle(request: Request, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  // Wrong/missing secret returns a plain 404 so a guessed path doesn't even confirm the route
  // exists — same shared-secret spirit as MCP_SECRET/SHORTCUT_SECRET/CRON_SECRET.
  if (!process.env.INBOUND_EMAIL_SECRET || secret !== process.env.INBOUND_EMAIL_SECRET) {
    return new Response("Not found", { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });

  const { from, subject, text } = readPayload(body);
  if (!from || !allowedSenders().includes(from)) {
    // Silently accept-and-ignore mail from unknown senders: return 200 so Postmark doesn't retry
    // or bounce, but create nothing.
    console.warn(`[email-inbound] ignored mail from non-allowlisted sender: ${from ?? "(unknown)"}`);
    return Response.json({ ignored: true });
  }

  if (!subject.trim() && !text.trim()) {
    return Response.json({ error: "Empty email" }, { status: 400 });
  }

  try {
    const categories = await getCategories();
    // Sender decides the context: mail from the work (YCIS) domain is work, everything else
    // (personal Gmail, etc.) is home. This biases both the AI's category choice and the fallback.
    const context: "work" | "home" = from.endsWith("@ycis.com") ? "work" : "home";
    const parsed = await parseEmailToItems(subject, text, categories, context);

    // Task requires a non-empty category; when the AI didn't assign one, default to a category
    // matching the sender's context — first by scope, then by the literal "Work"/"Home" name.
    const wantScope = context === "work" ? "WORK" : "HOME";
    const wantName = context === "work" ? "work" : "home";
    const defaultCategory =
      categories.find((c) => c.scope === wantScope)?.name ??
      categories.find((c) => c.name.toLowerCase() === wantName)?.name ??
      (context === "work" ? "Work" : "Home");
    const resolveCategory = (t: EmailTask) => t.category || defaultCategory;
    // The transcript field on the notice holds the source text for both voice and email; use the
    // subject so the notification panel shows something recognizable.
    const noticeTranscript = subject.trim() || text.slice(0, 120);

    if (parsed.kind === "PROJECT") {
      const project = await createProject({
        name: parsed.project.name,
        description: parsed.project.description,
        dueDate: parsed.project.dueDate,
      });
      for (const t of parsed.tasks) {
        await createTask({ ...t, category: resolveCategory(t), projectId: project.id });
      }
      const notice = await createVoiceCaptureNotice({
        transcript: noticeTranscript,
        kind: "PROJECT",
        entityId: project.id,
        summary: `${project.name} (${parsed.tasks.length} task${parsed.tasks.length === 1 ? "" : "s"})`,
        parseError: parsed.parseError,
        source: "EMAIL",
      });
      return Response.json({ kind: "project", projectId: project.id, taskCount: parsed.tasks.length, notice });
    }

    // Loose tasks: create each, and leave one notice per task so each surfaces for review.
    const created: { id: string; title: string }[] = [];
    for (const t of parsed.tasks) {
      const task = await createTask({ ...t, category: resolveCategory(t) });
      created.push({ id: task.id, title: task.title });
      await createVoiceCaptureNotice({
        transcript: noticeTranscript,
        kind: "TASK",
        entityId: task.id,
        summary: task.title,
        parseError: parsed.parseError,
        source: "EMAIL",
      });
    }
    return Response.json({ kind: "tasks", taskCount: created.length, tasks: created });
  } catch (err) {
    console.error("[email-inbound] failed:", err);
    const message = err instanceof Error ? err.message : "Email processing failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ secret: string }> }) {
  return handle(request, ctx);
}
