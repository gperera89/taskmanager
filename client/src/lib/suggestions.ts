import "server-only";
import {
  createSuggestions,
  deleteStaleSuggestions,
  getAiNotes,
  getAppSettings,
  getBlockedTasks,
  getDismissedCalendarEventIds,
  getOpenTaskTitles,
  getSuggestionDedupeIndex,
  getSuggestionFeedback,
  seedAiNotesIfEmpty,
  suggestionTitleKey,
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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// What the model must return — enforced via structured outputs (see lib/anthropic.ts).
const SUGGESTIONS_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
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
        required: ["kind", "title", "description", "suggestedDate", "eventId", "eventTitle"],
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

  const [{ events }, dismissedIds, notes, feedback, openTitles, dedupeIndex, settings, blockedTasks] = await Promise.all([
    getCalendarEvents().catch(() => ({ events: [], errors: ["calendar unavailable"] })),
    getDismissedCalendarEventIds().catch(() => [] as string[]),
    getAiNotes(),
    getSuggestionFeedback(),
    getOpenTaskTitles(),
    getSuggestionDedupeIndex(),
    getAppSettings(),
    getBlockedTasks().catch(() => []),
  ]);

  const dismissed = new Set(dismissedIds);
  const today = zonedYMD(now, settings.timeZone);
  const todayKey = dateKeyOf(today);

  // Clear out anything whose moment has passed before generating — otherwise the list the user
  // sees is dominated by prep for events that already happened.
  await deleteStaleSuggestions(todayKey);

  // The window is strictly forward-looking. The ICS feeds carry months of history, and feeding
  // past events to the model is what produced "prepare notes for the 5 August meeting" a
  // fortnight after that meeting. An event still counts as upcoming until the day it ends, so
  // multi-day events in progress stay in scope.
  const horizonKey = dateKeyOf(zonedYMD(new Date(now.getTime() + HOW_FAR_AHEAD_DAYS * MS_PER_DAY), settings.timeZone));
  const upcoming = events
    .filter((e) => !dismissed.has(e.id))
    .map((e) => ({
      id: e.id,
      title: e.title,
      date: dateKeyOf(zonedYMD(new Date(e.start), settings.timeZone)),
      endDate: dateKeyOf(zonedYMD(new Date(e.end), settings.timeZone)),
      allDay: e.allDay,
      source: e.source,
    }))
    .filter((e) => e.endDate >= todayKey && e.date <= horizonKey)
    .sort((a, b) => a.date.localeCompare(b.date));

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
    `- TODAY IS ${todayKey}. Every event you are given is today or later. Never propose work for something that has already happened, and never propose a suggestedDate before ${todayKey} — if the ideal prep day has passed, use ${todayKey}.`,
    "- Set eventId whenever the suggestion is tied to one of the listed events, so it can be matched back.",
    "- One suggestion per distinct piece of work. NEVER return two suggestions for the same event and kind, and never two whose titles say the same thing in different words — pick the single best-worded one.",
    "- Prep tasks get a suggestedDate 1-2 days BEFORE the event; follow-ups the day of or after.",
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
    `Upcoming calendar events — today through the next ${HOW_FAR_AHEAD_DAYS} days, earliest first (nothing before today is listed):`,
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

  // Defensive coercion — never trust field shapes. Three gates, all enforced here rather than in
  // the prompt, because the model has repeatedly failed each of them:
  //   1. dedupeKey is *derived*, not accepted: one key per kind+event (or kind+day+title for a
  //      novel idea), so two phrasings of the same work collapse onto one row.
  //   2. a normalised kind+title index catches near-duplicates the key can't (same idea proposed
  //      against no event, or against two different events).
  //   3. suggestedDate is clamped forward to today — nothing lands in the past.
  const validEventIds = new Set(upcoming.map((e) => e.id));
  const openTitleKeys = new Set(openTitles.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const rows: Parameters<typeof createSuggestions>[0] = [];
  let skipped = 0;
  for (const item of list) {
    const s = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const title = typeof s.title === "string" ? s.title.trim().slice(0, 200) : "";
    const kind = typeof s.kind === "string" ? s.kind.trim().slice(0, 40) : "";
    if (!title || !kind) {
      skipped++;
      continue;
    }

    const rawEventId = typeof s.eventId === "string" ? s.eventId.trim() : "";
    const eventId = validEventIds.has(rawEventId) ? rawEventId : null; // ignore invented/stale ids
    const titleKey = suggestionTitleKey(kind, title);
    const dedupeKey = (eventId ? `${kind}:${eventId}` : `${kind}:${todayKey}:${titleKey}`).slice(0, 300);

    // Any status counts: dismissed stays dead, accepted never regenerates.
    if (dedupeIndex.keys.has(dedupeKey) || dedupeIndex.titleKeys.has(titleKey)) {
      skipped++;
      continue;
    }
    // Already on the user's plate as an open task.
    if (openTitleKeys.has(title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())) {
      skipped++;
      continue;
    }
    dedupeIndex.keys.add(dedupeKey); // in-batch dedupe too
    dedupeIndex.titleKeys.add(titleKey);

    const proposedDate = typeof s.suggestedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.suggestedDate) ? s.suggestedDate : null;
    rows.push({
      dedupeKey,
      kind,
      title,
      description: typeof s.description === "string" && s.description.trim() ? s.description.trim().slice(0, 500) : null,
      eventId,
      eventTitle: typeof s.eventTitle === "string" && s.eventTitle.trim() ? s.eventTitle.trim().slice(0, 200) : null,
      suggestedDate: proposedDate && proposedDate < todayKey ? todayKey : proposedDate,
    });
  }

  if (rows.length) await createSuggestions(rows);
  return { created: rows.length, skipped };
}
