import "server-only";
import type { HabitScheduleType, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROUTINE_FREQUENCIES: RoutineFrequency[] = ["DAILY", "WEEKLY", "MONTHLY"];
const ROUTINE_MONTHLY_MODES: RoutineMonthlyMode[] = ["DATE", "WEEKDAY"];
const HABIT_SCHEDULE_TYPES: HabitScheduleType[] = ["WEEKLY_DAYS", "WEEKLY_COUNT", "MONTHLY_COUNT"];

export type ParsedCapture =
  | {
      kind: "TASK";
      parseError: boolean;
      task: {
        title: string;
        description: string | null;
        category: string | null;
        dueDate: string | null;
        dueTime: string | null;
        projectId: string | null;
      };
    }
  | { kind: "PROJECT"; parseError: false; project: { name: string; description: string | null; dueDate: string | null } }
  | {
      kind: "ROUTINE";
      parseError: false;
      routine: {
        title: string;
        reminderTime: string;
        frequency: RoutineFrequency;
        interval: number;
        daysOfWeek: number[];
        monthlyMode: RoutineMonthlyMode;
        dayOfMonth: number | null;
        monthlyOrdinal: number | null;
        monthlyWeekday: number | null;
      };
    }
  | { kind: "HABIT"; parseError: false; habit: { title: string; scheduleType: HabitScheduleType; targetCount: number; daysOfWeek: number[] } };

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

// Matches how the rest of the app defines "today" (local calendar fields, see page.tsx) so a
// voice capture's date math lines up with the day the user is actually looking at.
function localDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Normalizes an "H:MM"/"HH:MM" clock time to zero-padded "HH:MM", or null if malformed.
function normalizeTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const hh = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Whisper picks its decoder from the upload's filename extension, so we make sure the file we send
// has one that matches its actual container. The in-app recorder sends webm; the iPhone Shortcut
// sends m4a (audio/mp4). If the incoming File already has a real extension we keep it.
function whisperFilename(file: File): string {
  if (file.name && /\.[a-z0-9]+$/i.test(file.name)) return file.name;
  const byType: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/aac": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  const ext = byType[file.type] ?? "m4a";
  return `recording.${ext}`;
}

// Sends the recorded clip to OpenAI's Whisper API and returns the transcribed text.
export async function transcribeAudio(file: File): Promise<string> {
  const apiKey = requireApiKey();

  const form = new FormData();
  form.append("file", file, whisperFilename(file));
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
  const today = localDateString(now);

  const systemPrompt = `You turn a spoken voice memo into a structured item for a task manager app.
Today is ${today} (${WEEKDAY_NAMES[now.getDay()]}).
Existing categories: ${categories.join(", ") || "(none)"}.
Existing projects: ${projects.map((p) => `${p.name} (id: ${p.id})`).join(", ") || "(none)"}.

First decide which kind of item this is:
- "task": a one-off actionable item. Default to this unless another kind is clearly indicated.
- "project": a larger initiative made of multiple tasks — only choose this if they explicitly describe a project.
- "routine": something that repeats on an ongoing schedule (e.g. "every morning at 7am", "each Monday and Wednesday", "daily"). Only choose this when the wording clearly implies recurrence. A one-off reminder for a single occasion — even one that names a time of day like "this evening" or "at 3pm" — is a task, not a routine.
- "habit": a recurring practice tracked by streak, with no specific clock time (e.g. "meditate daily", "read every week").

Reply with ONLY a JSON object with these fields (use null for any field not relevant to the chosen kind):
- kind: "task" | "project" | "routine" | "habit"
- title: string, a short title/name for the item (required)
- description: string or null, extra detail (task/project only)
- category: string or null, must exactly match one of the existing categories (task only), else null
- dueDate: string or null, "YYYY-MM-DD" resolved from relative dates like "tomorrow" or "this evening" (= today) (task/project only)
- dueTime: string or null, "HH:MM" 24h clock time (task only). Use the exact time if one is said (e.g. "3pm" -> "15:00"). If only a rough time of day is said, approximate it: morning->"09:00", afternoon->"14:00", evening->"18:00", night->"20:00". Use null if no time of day is mentioned at all.
- projectId: string or null, must exactly match one of the existing project ids (task only), else null
- reminderTime: string or null, "HH:MM" 24h clock time (routine only)
- frequency: "DAILY" | "WEEKLY" | "MONTHLY" | null (routine only)
- interval: number or null, "every N ___" (routine only), e.g. 2 for "every 2 weeks" — default 1
- daysOfWeek: number[] or null, 0=Sunday..6=Saturday (routine, only when frequency is WEEKLY)
- monthlyMode: "DATE" | "WEEKDAY" | null (routine, only when frequency is MONTHLY). DATE = a fixed day of the month (e.g. "the 12th", "the last day"). WEEKDAY = the Nth weekday of the month (e.g. "the first Wednesday", "the last Friday").
- dayOfMonth: number or null, 1-31, or -1 to mean "the last day of the month" (routine, only when frequency is MONTHLY and monthlyMode is DATE)
- monthlyOrdinal: number or null, 1-5 for First..Fifth, or -1 for "Last" (routine, only when frequency is MONTHLY and monthlyMode is WEEKDAY)
- monthlyWeekday: number or null, 0=Sunday..6=Saturday (routine, only when frequency is MONTHLY and monthlyMode is WEEKDAY)
- habitScheduleType: "WEEKLY_DAYS" | "WEEKLY_COUNT" | "MONTHLY_COUNT" | null (habit only). WEEKLY_DAYS = specific days of the week (e.g. "weekdays", "every Monday and Thursday"). WEEKLY_COUNT = a number of times per week (e.g. "twice a week"). MONTHLY_COUNT = a number of times per month (e.g. "ten times a month"). Default to WEEKLY_DAYS with every day if the wording is a plain "daily".
- habitDaysOfWeek: number[] or null, 0=Sunday..6=Saturday (habit, only when habitScheduleType is WEEKLY_DAYS)
- habitTargetCount: number or null, the "N times" count (habit, only when habitScheduleType is WEEKLY_COUNT or MONTHLY_COUNT)`;

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
      const reminderTime = normalizeTime(parsed.reminderTime) ?? "09:00";
      const interval = Number.isInteger(parsed.interval) && parsed.interval > 0 ? parsed.interval : 1;
      const daysOfWeek = Array.isArray(parsed.daysOfWeek)
        ? parsed.daysOfWeek.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
        : [];
      const monthlyMode = ROUTINE_MONTHLY_MODES.includes(parsed.monthlyMode) ? (parsed.monthlyMode as RoutineMonthlyMode) : "DATE";
      const dayOfMonth =
        Number.isInteger(parsed.dayOfMonth) && (parsed.dayOfMonth === -1 || (parsed.dayOfMonth >= 1 && parsed.dayOfMonth <= 31))
          ? (parsed.dayOfMonth as number)
          : null;
      const monthlyOrdinal =
        Number.isInteger(parsed.monthlyOrdinal) && (parsed.monthlyOrdinal === -1 || (parsed.monthlyOrdinal >= 1 && parsed.monthlyOrdinal <= 5))
          ? (parsed.monthlyOrdinal as number)
          : null;
      const monthlyWeekday =
        Number.isInteger(parsed.monthlyWeekday) && parsed.monthlyWeekday >= 0 && parsed.monthlyWeekday <= 6
          ? (parsed.monthlyWeekday as number)
          : null;
      return {
        kind: "ROUTINE",
        parseError: false,
        routine: { title: fallbackTitle(parsed.title, transcript), reminderTime, frequency, interval, daysOfWeek, monthlyMode, dayOfMonth, monthlyOrdinal, monthlyWeekday },
      };
    }

    if (parsed.kind === "habit") {
      const scheduleType = HABIT_SCHEDULE_TYPES.includes(parsed.habitScheduleType)
        ? (parsed.habitScheduleType as HabitScheduleType)
        : "WEEKLY_DAYS";
      const daysOfWeek = Array.isArray(parsed.habitDaysOfWeek)
        ? parsed.habitDaysOfWeek.filter((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6)
        : [];
      const targetCount = Number.isInteger(parsed.habitTargetCount) && parsed.habitTargetCount > 0 ? parsed.habitTargetCount : 1;
      // Fall back to "every day" if the model chose days-of-week but named none.
      const resolvedDays = scheduleType === "WEEKLY_DAYS" && daysOfWeek.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : daysOfWeek;
      return {
        kind: "HABIT",
        parseError: false,
        habit: { title: fallbackTitle(parsed.title, transcript), scheduleType, targetCount, daysOfWeek: resolvedDays },
      };
    }

    const category = typeof parsed.category === "string" && categories.includes(parsed.category) ? parsed.category : null;
    const projectId = typeof parsed.projectId === "string" && projects.some((p) => p.id === parsed.projectId) ? parsed.projectId : null;
    // A voice-captured task always gets a due date — today if nothing more specific was said —
    // so it never silently drops into the "no date" pile.
    const dueDate = dateOrNull(parsed.dueDate) ?? today;
    const dueTime = normalizeTime(parsed.dueTime);
    return {
      kind: "TASK",
      parseError: false,
      task: { title: fallbackTitle(parsed.title, transcript), description: strOrNull(parsed.description), category, dueDate, dueTime, projectId },
    };
  } catch {
    return {
      kind: "TASK",
      parseError: true,
      task: { title: transcript.slice(0, 80), description: transcript, category: null, dueDate: today, dueTime: null, projectId: null },
    };
  }
}
