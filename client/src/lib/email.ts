import "server-only";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// A single actionable task extracted from an email. Mirrors the shape createTask() accepts,
// minus the fields email can't sensibly infer (recurrence, reminders, parent/section).
export type EmailTask = {
  title: string;
  description: string | null;
  category: string | null;
  dueDate: string | null;
  dueTime: string | null;
};

// The LLM decides whether an email is a handful of loose tasks, or a larger initiative worth
// breaking into a project with subtasks.
export type ParsedEmail =
  | { kind: "TASKS"; parseError: boolean; tasks: EmailTask[] }
  | {
      kind: "PROJECT";
      parseError: boolean;
      project: { name: string; description: string | null; dueDate: string | null };
      tasks: EmailTask[];
    };

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

// Matches how the rest of the app defines "today" (local calendar fields, see page.tsx).
function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function normalizeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const hh = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Coerce one raw LLM task object into a validated EmailTask, constrained to real categories.
function coerceTask(raw: unknown, categories: string[], fallback: string): EmailTask {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const category = typeof t.category === "string" && categories.includes(t.category) ? t.category : null;
  return {
    title: strOrNull(t.title) ?? fallback,
    description: strOrNull(t.description),
    category,
    dueDate: dateOrNull(t.dueDate),
    dueTime: normalizeTime(t.dueTime),
  };
}

// Truncate the email body before sending to the model — a long thread/newsletter would blow the
// token budget, and the actionable content is nearly always near the top.
const MAX_BODY_CHARS = 8000;

// Subject-line prefixes are the user's explicit lever over the task/project split, so the outcome
// is never left to the model's judgement when they care:
//   "Project: ..."             -> always a project broken into subtasks
//   "Task:/Tasks:/Todo: ..."   -> always one or more loose tasks
//   (no prefix)                -> loose tasks (we never auto-create a project without the keyword)
const PROJECT_PREFIX = /^\s*project\s*:\s*/i;
const TASKS_PREFIX = /^\s*(?:tasks?|todos?)\s*:\s*/i;

// Decide the shape from the subject prefix and return the subject with the prefix stripped (so the
// prefix doesn't bleed into the title/project name).
function detectMode(subject: string): { mode: "project" | "tasks"; cleanSubject: string } {
  if (PROJECT_PREFIX.test(subject)) return { mode: "project", cleanSubject: subject.replace(PROJECT_PREFIX, "").trim() };
  if (TASKS_PREFIX.test(subject)) return { mode: "tasks", cleanSubject: subject.replace(TASKS_PREFIX, "").trim() };
  return { mode: "tasks", cleanSubject: subject.trim() };
}

// The email's context, derived by the caller from the sender address (work vs personal), used to
// bias category selection toward the matching scope.
export type EmailContext = "work" | "home";

// Asks gpt-4o-mini to turn an email into either loose tasks or a project-with-subtasks, extracting
// due dates/categories per task. The task/project split is decided deterministically by the
// subject prefix (see detectMode) rather than left to the model. Categories are constrained to the
// caller's existing ones, biased toward those appropriate for the sender's context.
export async function parseEmailToItems(
  subject: string,
  body: string,
  categories: { name: string; scope: string }[],
  context: EmailContext
): Promise<ParsedEmail> {
  const apiKey = requireApiKey();
  const now = new Date();
  const today = localDateString(now);
  const trimmedBody = body.slice(0, MAX_BODY_CHARS);
  const { mode, cleanSubject } = detectMode(subject);
  const fallbackTitle = strOrNull(cleanSubject) ?? "Untitled";

  const categoryNames = categories.map((c) => c.name);
  const contextLabel = context === "work" ? "work" : "personal";
  // Categories suited to this context: matching scope, plus NONE ("both") categories.
  const wantScope = context === "work" ? "WORK" : "HOME";
  const preferred = categories.filter((c) => c.scope === wantScope || c.scope === "NONE").map((c) => c.name);

  const shapeInstruction =
    mode === "project"
      ? "The user has explicitly marked this email as a PROJECT. Produce a project and break the work into smaller subtasks."
      : "Produce one or more independent tasks. Do NOT create a project.";

  const systemPrompt = `You turn an email into structured work for a personal task manager.
Today is ${today} (${WEEKDAY_NAMES[now.getDay()]}).
This email arrived at the user's ${contextLabel} address, so treat it as ${contextLabel} context.
Existing categories: ${categoryNames.join(", ") || "(none)"}.
Prefer one of these ${contextLabel}-appropriate categories: ${preferred.join(", ") || "(none)"}.

Extract only the genuinely actionable content. Ignore greetings, signatures, disclaimers, quoted
prior replies, and marketing boilerplate. If the email contains nothing actionable, return an
empty task list.

${shapeInstruction}

Reply with ONLY a JSON object:
- project: object or null. ${mode === "project" ? 'Required: { name: string, description: string|null, dueDate: "YYYY-MM-DD"|null }.' : "Always null for this email."}
- tasks: array of task objects (${mode === "project" ? "the subtasks of the project" : "the standalone tasks"}). Each task:
    - title: string (required, short and imperative)
    - description: string|null (extra detail; keep concise)
    - category: string|null — must EXACTLY match one of the existing categories above, else null. Prefer a ${contextLabel}-appropriate one.
    - dueDate: string|null — "YYYY-MM-DD", resolved from relative dates like "tomorrow"/"next Friday" or explicit dates in the email
    - dueTime: string|null — "HH:MM" 24h, only if a specific time is stated`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Subject: ${cleanSubject}\n\n${trimmedBody}` },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Email parsing failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(rawContent);
    const rawTasks: unknown[] = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const tasks = rawTasks.map((t, i) => coerceTask(t, categoryNames, `${fallbackTitle} (${i + 1})`));

    // The subject prefix — not the model — decides the shape.
    if (mode === "project") {
      const p = (parsed.project && typeof parsed.project === "object" ? parsed.project : {}) as Record<string, unknown>;
      return {
        kind: "PROJECT",
        parseError: false,
        project: {
          name: strOrNull(p.name) ?? fallbackTitle,
          description: strOrNull(p.description),
          dueDate: dateOrNull(p.dueDate),
        },
        tasks,
      };
    }

    return { kind: "TASKS", parseError: false, tasks };
  } catch {
    // Couldn't parse the model's JSON — fall back to filing the whole email as one task so nothing
    // is silently dropped, and flag it for review.
    return {
      kind: "TASKS",
      parseError: true,
      tasks: [{ title: fallbackTitle, description: strOrNull(trimmedBody), category: null, dueDate: null, dueTime: null }],
    };
  }
}
