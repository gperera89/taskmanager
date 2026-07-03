import "server-only";
import type { HabitFrequency, RoutineFrequency } from "@prisma/client";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];
const HABIT_FREQUENCIES: HabitFrequency[] = ["DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"];

export type ParsedCapture =
  | {
      kind: "TASK";
      parseError: boolean;
      task: { title: string; description: string | null; category: string | null; dueDate: string | null; projectId: string | null };
    }
  | { kind: "PROJECT"; parseError: false; project: { name: string; description: string | null; dueDate: string | null } }
  | {
      kind: "ROUTINE";
      parseError: false;
      routine: { title: string; reminderTime: string; frequency: RoutineFrequency; daysOfWeek: number[]; dayOfMonth: number | null };
    }
  | { kind: "HABIT"; parseError: false; habit: { title: string; frequency: HabitFrequency; customIntervalDays: number | null } };

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

// Sends the recorded clip to OpenAI's Whisper API and returns the transcribed text.
export async function transcribeAudio(file: File): Promise<string> {
  const apiKey = requireApiKey();

  const form = new FormData();
  form.append("file", file, file.name || "recording.webm");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper transcription failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const transcript = String(data.text ?? "").trim();
  if (!transcript) throw new Error("Transcription returned no text");
  return transcript;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function fallbackTitle(raw: unknown, transcript: string): string {
  return strOrNull(raw) ?? transcript.slice(0, 80);
}

// Asks gpt-4o-mini to classify the transcript as a task/project/routine/habit and extract the
// fields for whichever kind it picked, constrained to the caller's existing categories/projects
// so it can't invent ids that don't exist.
export async function parseCaptureFromTranscript(
  transcript: string,
  categories: string[],
  projects: { id: string; name: string }[]
): Promise<ParsedCapture> {
  const apiKey = requireApiKey();
  const now = new Date();

  const systemPrompt = `You turn a spoken voice memo into a structured item for a task manager app.
Today is ${now.toISOString().slice(0, 10)} (${WEEKDAY_NAMES[now.getDay()]}).
Existing categories: ${categories.join(", ") || "(none)"}.
Existing projects: ${projects.map((p) => `${p.name} (id: ${p.id})`).join(", ") || "(none)"}.

First decide which kind of item this is:
- "task": a one-off actionable item. Default to this unless another kind is clearly indicated.
- "project": a larger initiative made of multiple tasks — only choose this if they explicitly describe a project.
- "routine": a recurring reminder at a specific time of day (they mention a clock time and repetition, e.g. "every morning at 7am").
- "habit": a recurring practice tracked by streak, with no specific clock time (e.g. "meditate daily", "read every week").

Reply with ONLY a JSON object with these fields (use null for any field not relevant to the chosen kind):
- kind: "task" | "project" | "routine" | "habit"
- title: string, a short title/name for the item (required)
- description: string or null, extra detail (task/project only)
- category: string or null, must exactly match one of the existing categories (task only), else null
- dueDate: string or null, "YYYY-MM-DD" resolved from relative dates like "tomorrow" (task/project only)
- projectId: string or null, must exactly match one of the existing project ids (task only), else null
- reminderTime: string or null, "HH:MM" 24h clock time (routine only)
- frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "FORTNIGHTLY" | "CUSTOM" | null (routine: DAILY/WEEKLY/MONTHLY only; habit: any of the five)
- daysOfWeek: number[] or null, 0=Sunday..6=Saturday (routine, only when frequency is WEEKLY)
- dayOfMonth: number or null, 1-31 (routine, only when frequency is MONTHLY)
- customIntervalDays: number or null, "every N days" (habit, only when frequency is CUSTOM)`;

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
        { role: "user", content: transcript },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`Capture parsing failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(raw);

    if (parsed.kind === "project") {
      return {
        kind: "PROJECT",
        parseError: false,
        project: { name: fallbackTitle(parsed.title, transcript), description: strOrNull(parsed.description), dueDate: dateOrNull(parsed.dueDate) },
      };
    }

    if (parsed.kind === "routine") {
      const frequency = ROUTINE_FREQUENCIES.includes(parsed.frequency) ? (parsed.frequency as RoutineFrequency) : "DAILY";
      const reminderTime = typeof parsed.reminderTime === "string" && /^\d{1,2}:\d{2}$/.test(parsed.reminderTime) ? parsed.reminderTime : "09:00";
      const daysOfWeek = Array.isArray(parsed.daysOfWeek)
        ? parsed.daysOfWeek.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
        : [];
      const dayOfMonth = Number.isInteger(parsed.dayOfMonth) ? (parsed.dayOfMonth as number) : null;
      return {
        kind: "ROUTINE",
        parseError: false,
        routine: { title: fallbackTitle(parsed.title, transcript), reminderTime, frequency, daysOfWeek, dayOfMonth },
      };
    }

    if (parsed.kind === "habit") {
      const frequency = HABIT_FREQUENCIES.includes(parsed.frequency) ? (parsed.frequency as HabitFrequency) : "DAILY";
      const customIntervalDays =
        frequency === "CUSTOM" ? (Number.isInteger(parsed.customIntervalDays) && parsed.customIntervalDays > 0 ? parsed.customIntervalDays : 2) : null;
      return {
        kind: "HABIT",
        parseError: false,
        habit: { title: fallbackTitle(parsed.title, transcript), frequency, customIntervalDays },
      };
    }

    const category = typeof parsed.category === "string" && categories.includes(parsed.category) ? parsed.category : null;
    const projectId = typeof parsed.projectId === "string" && projects.some((p) => p.id === parsed.projectId) ? parsed.projectId : null;
    return {
      kind: "TASK",
      parseError: false,
      task: { title: fallbackTitle(parsed.title, transcript), description: strOrNull(parsed.description), category, dueDate: dateOrNull(parsed.dueDate), projectId },
    };
  } catch {
    return {
      kind: "TASK",
      parseError: true,
      task: { title: transcript.slice(0, 80), description: transcript, category: null, dueDate: null, projectId: null },
    };
  }
}
