import "server-only";
import {
  createSuggestions,
  getAllSuggestionDedupeKeys,
  getAiNotes,
  getAppSettings,
  getBlockedTasks,
  getDismissedCalendarEventIds,
  getOpenTaskTitles,
  getSuggestionFeedback,
  seedAiNotesIfEmpty,
  wakeDueSnoozedSuggestions,
} from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import { anthropicJson } from "@/lib/anthropic";
import { zonedYMD } from "@/lib/taskbookDates";
import { pad2 } from "@/lib/taskbookDates";

// The user's stated workflow rules, seeded as editable AiNotes on first run. From then on the
// notes table is the source of truth — edits/additions in the app change the prompt directly.
const DEFAULT_AI_NOTES = [
  "For every scheduled lesson on the calendar: suggest planning time beforehand (making the presentation, printing any worksheets/booklets, checking homework), and suggest sharing the slides with students after the lesson.",
  "For admission interviews: suggest time to review the application/student files beforehand, and time to write the interview report afterwards.",
  "For educational goals meetings: suggest time to review the student's files beforehand, and time to write up the meeting afterwards.",
  "For birthdays on the calendar: suggest writing a birthday message to that person.",
  "For meetings with leaders or colleagues: suggest preparing notes ahead of the meeting.",
];

const HOW_FAR_AHEAD_DAYS = 14;

// What the model must return — enforced via structured outputs (see lib/anthropic.ts).
const SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dedupeKey: { type: "string" },
          kind: {
            type: "string",
            enum: ["lesson-prep", "interview-review", "report", "birthday", "meeting-notes", "share-slides", "blocked-followup", "novel"],
          },
          title: { type: "string" },
          description: { type: ["string", "null"] },
          suggestedDate: { type: ["string", "null"], format: "date" },
          eventId: { type: ["string", "null"] },
          eventTitle: { type: ["string", "null"] },
        },
        required: ["dedupeKey", "kind", "title", "description", "suggestedDate", "eventId", "eventTitle"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

function dateKeyOf(ymd: { year: number; month0: number; day: number }): string {
  return `${ymd.year}-${pad2(ymd.month0 + 1)}-${pad2(ymd.day)}`;
}

// Generate today's batch of AI suggestions: read the next two weeks of calendar events plus the
// user's notes and feedback history, ask Claude for prep/follow-up task ideas, and persist the
// new (non-duplicate) ones as PENDING rows. Returns counts for the cron response.
export async function generateSuggestions(): Promise<{ created: number; skipped: number }> {
  await seedAiNotesIfEmpty(DEFAULT_AI_NOTES);
  const now = new Date();
  await wakeDueSnoozedSuggestions(now);

  const [{ events }, dismissedIds, notes, feedback, openTitles, existingKeys, settings, blockedTasks] = await Promise.all([
    getCalendarEvents().catch(() => ({ events: [], errors: ["calendar unavailable"] })),
    getDismissedCalendarEventIds().catch(() => [] as string[]),
    getAiNotes(),
    getSuggestionFeedback(),
    getOpenTaskTitles(),
    getAllSuggestionDedupeKeys(),
    getAppSettings(),
    getBlockedTasks().catch(() => []),
  ]);

  const dismissed = new Set(dismissedIds);
  const today = zonedYMD(now, settings.timeZone);
  const todayKey = dateKeyOf(today);
  const horizonMs = now.getTime() + HOW_FAR_AHEAD_DAYS * 24 * 60 * 60 * 1000;
  const upcoming = events
    .filter((e) => !dismissed.has(e.id) && new Date(e.start).getTime() <= horizonMs)
    .map((e) => ({
      id: e.id,
      title: e.title,
      date: dateKeyOf(zonedYMD(new Date(e.start), settings.timeZone)),
      allDay: e.allDay,
      source: e.source,
    }));

  const statLines = feedback.stats.map((s) => `${s.kind} ${s.status.toLowerCase()}: ${s.count}`).join(", ") || "none yet";
  const exampleLines =
    feedback.recent
      .map((r) => `- [${r.status.toLowerCase()}] ${r.kind}: "${r.title}"${r.eventTitle ? ` (for "${r.eventTitle}")` : ""}`)
      .join("\n") || "- none yet";

  const system = [
    "You are the planning assistant inside Cura, a personal task manager for a teacher at YCIS Shanghai Pudong.",
    "Your job: look at the upcoming calendar events and propose concrete preparation/follow-up tasks the user would otherwise forget.",
    "",
    "The user's standing instructions (follow these closely):",
    ...notes.map((n) => `- ${n.content}`),
    "",
    "Rules:",
    `- dedupeKey must be "<kind>:<eventId>" when tied to a calendar event, or "<kind>:${todayKey}:<short-slug>" for a novel idea.`,
    "- One suggestion per distinct piece of work. Prep tasks get a suggestedDate 1-2 days BEFORE the event; follow-ups the day of or after.",
    "- Do not suggest anything already covered by an existing open task (list provided).",
    "- Learn from the feedback history: propose more of what gets accepted, stop proposing what gets dismissed.",
    "- Blocked tasks: some tasks are on hold, each with a waiting-on note and an expected-clear date. When a block is expected to clear today or has passed, suggest a 'blocked-followup' to check whether it resolved and pick the task back up. When a deadline (task or project) is looming while the task is still blocked, suggest a proactive 'blocked-followup' to chase what it's waiting on. Do not suggest working on a task while its block is still active.",
    "- Include AT MOST ONE 'novel' suggestion per run — a genuinely useful blind-spot idea outside the standing rules.",
    "- Keep titles short and actionable. Descriptions optional, one sentence.",
    "- If nothing is worth suggesting, return an empty array.",
  ].join("\n");

  const user = [
    `Today is ${todayKey} (${new Date(Date.UTC(today.year, today.month0, today.day)).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}).`,
    "",
    `Upcoming calendar events (next ${HOW_FAR_AHEAD_DAYS} days):`,
    JSON.stringify(upcoming),
    "",
    "Existing open tasks (do not duplicate):",
    JSON.stringify(openTitles),
    "",
    "Blocked (on-hold) tasks:",
    blockedTasks.length ? JSON.stringify(blockedTasks) : "none",
    "",
    `Feedback so far — per-kind counts: ${statLines}`,
    "Recent responses:",
    exampleLines,
  ].join("\n");

  const raw = await anthropicJson({ system, user, schema: SUGGESTIONS_SCHEMA as unknown as Record<string, unknown> });
  const list = (raw as { suggestions?: unknown[] } | null)?.suggestions;
  if (!Array.isArray(list)) return { created: 0, skipped: 0 };

  // Defensive coercion — never trust field shapes, and drop anything whose dedupeKey has ever
  // been seen (any status: dismissed stays dead, accepted never regenerates).
  const rows: Parameters<typeof createSuggestions>[0] = [];
  let skipped = 0;
  for (const item of list) {
    const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const dedupeKey = typeof s.dedupeKey === "string" ? s.dedupeKey.trim().slice(0, 300) : "";
    const title = typeof s.title === "string" ? s.title.trim().slice(0, 200) : "";
    const kind = typeof s.kind === "string" ? s.kind.trim().slice(0, 40) : "";
    if (!dedupeKey || !title || !kind || existingKeys.has(dedupeKey)) {
      skipped++;
      continue;
    }
    existingKeys.add(dedupeKey); // in-batch dedupe too
    rows.push({
      dedupeKey,
      kind,
      title,
      description: typeof s.description === "string" && s.description.trim() ? s.description.trim().slice(0, 500) : null,
      eventId: typeof s.eventId === "string" && s.eventId.trim() ? s.eventId.trim() : null,
      eventTitle: typeof s.eventTitle === "string" && s.eventTitle.trim() ? s.eventTitle.trim().slice(0, 200) : null,
      suggestedDate: typeof s.suggestedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.suggestedDate) ? s.suggestedDate : null,
    });
  }

  if (rows.length) await createSuggestions(rows);
  return { created: rows.length, skipped };
}
