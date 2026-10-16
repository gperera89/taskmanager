import "server-only";
import {
  clearPendingSuggestions,
  countPendingSuggestions,
  createSuggestions,
  deleteStaleSuggestions,
  getAiNotes,
  getAppSettings,
  getBlockedTasks,
  getDismissedCalendarEventIds,
  getOpenTaskTitles,
  getPlannerContext,
  getSuggestionDedupeIndex,
  getSuggestionFeedback,
  setAiDurationEstimates,
  suggestionTitleKey,
  wakeDueSnoozedSuggestions,
} from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import { openaiJson } from "@/lib/openaiJson";
import { zonedYMD } from "@/lib/taskbookDates";
import { pad2 } from "@/lib/taskbookDates";

// The model's standing instructions are the AiNote rows (Settings → AI planner notes) and nothing
// else. Earlier versions seeded a set of default workflow notes whenever the table was empty and
// baked matching kinds into the schema — that kept resurrecting workflows the user had moved
// elsewhere (lesson prep now lives in the Lesson Planner app), so neither exists any more.

// Ideas are kept to a small daily set: the Tasks view shows the first VISIBLE_SUGGESTIONS and
// pulls the next one in as each is added or dismissed.
const DAILY_SUGGESTIONS = 5;

const HOW_FAR_AHEAD_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// What the model must return — enforced via structured outputs (see lib/openaiJson.ts).
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
            enum: ["prep", "follow-up", "next-step", "chase", "deadline", "birthday", "idea"],
          },
          title: { type: "string" },
          description: { type: ["string", "null"] },
          suggestedDate: { type: ["string", "null"], format: "date" },
          eventId: { type: ["string", "null"] },
          eventTitle: { type: ["string", "null"] },
          projectId: { type: ["string", "null"] },
        },
        required: ["kind", "title", "description", "suggestedDate", "eventId", "eventTitle", "projectId"],
        additionalProperties: false,
      },
    },
    durations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          minutes: { type: "integer" },
        },
        required: ["taskId", "minutes"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions", "durations"],
  additionalProperties: false,
} as const;

function dateKeyOf(ymd: { year: number; month0: number; day: number }): string {
  return `${ymd.year}-${pad2(ymd.month0 + 1)}-${pad2(ymd.day)}`;
}

// Generate the day's AI suggestions: read the next two weeks of calendar events, the user's active
// projects, blocked tasks, notes and feedback history, and ask the model for up to DAILY_SUGGESTIONS
// task ideas. The same call estimates a duration for every overdue/due-today task that has none
// (stored as Task.aiDurationMinutes for the Tasks view's suggested-time chip).
//
// `fresh` (the morning cron) drops yesterday's unanswered ideas and starts a new set of five;
// without it (the ↻ button) the existing ideas stay and only the gap up to five is filled.
export async function generateSuggestions({ fresh = false }: { fresh?: boolean } = {}): Promise<{
  created: number;
  skipped: number;
  durations: number;
}> {
  const now = new Date();
  await wakeDueSnoozedSuggestions(now);
  if (fresh) await clearPendingSuggestions();

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
  const [pendingCount, context] = await Promise.all([countPendingSuggestions(), getPlannerContext(todayKey)]);
  const wanted = Math.max(0, DAILY_SUGGESTIONS - pendingCount);
  if (wanted === 0 && context.needsDuration.length === 0) return { created: 0, skipped: 0, durations: 0 };

  // The window is strictly forward-looking. The ICS feeds carry months of history, and feeding
  // past events to the model is what produced "prepare notes for the 5 August meeting" a
  // fortnight after that meeting. An event still counts as upcoming until the day it ends, so
  // multi-day events in progress stay in scope — but a timed event that has already finished
  // today is over (no prepping for this morning's meeting at 8pm).
  const horizonKey = dateKeyOf(zonedYMD(new Date(now.getTime() + HOW_FAR_AHEAD_DAYS * MS_PER_DAY), settings.timeZone));
  const upcoming = events
    .filter((e) => !dismissed.has(e.id) && (e.allDay || new Date(e.end).getTime() > now.getTime()))
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
    "You have two jobs:",
    `1. Propose up to ${wanted} task ideas the user would otherwise forget (return fewer, or none, rather than pad the list with filler). Draw on the calendar AND the user's own work: a project with no open or dated tasks needs a next step; a project deadline approaching with nothing scheduled needs a plan; a blocked task needs chasing; a calendar event may need prep or a follow-up. Order them most useful first.`,
    "2. Estimate a realistic duration in minutes (5–240, in 5-minute steps) for every task listed under 'Tasks needing a duration'. Return one entry per task, using its exact id.",
    "",
    "The user's standing instructions (follow these closely — they override the general guidance below):",
    ...(notes.length ? notes.map((n) => `- ${n.content}`) : ["- none"]),
    "",
    "Rules:",
    `- TODAY IS ${todayKey}. Every event you are given is today or later. Never propose work for something that has already happened, and never propose a suggestedDate before ${todayKey} — if the ideal prep day has passed, use ${todayKey}.`,
    "- Set eventId whenever the suggestion is tied to one of the listed events, so it can be matched back.",
    "- Set projectId (exact id from the list) whenever the idea belongs to one of the user's projects, so the task lands in that project.",
    "- Kinds: prep (before an event), follow-up (after an event), next-step (a project with no clear next action), chase (a blocked task or something waiting on someone), deadline (a deadline approaching with nothing scheduled), birthday, idea (anything else).",
    "- Don't propose routine preparation for ordinary meetings or lessons unless a standing instruction asks for it — the user has their own workflows for those.",
    "- One suggestion per distinct piece of work. NEVER return two suggestions for the same event and kind, and never two whose titles say the same thing in different words — pick the single best-worded one.",
    "- Prep tasks get a suggestedDate 1-2 days BEFORE the event; follow-ups the day of or after.",
    "- Do not suggest anything already covered by an existing open task (list provided).",
    "- Learn from the feedback history: propose more of what gets accepted, stop proposing what gets dismissed.",
    "- Blocked tasks: some tasks are on hold, each with a waiting-on note and an expected-clear date. When a block is expected to clear today or has passed, suggest a 'chase' to check whether it resolved and pick the task back up. When a deadline (task or project) is looming while the task is still blocked, suggest a proactive 'chase' for what it's waiting on. Do not suggest working on a task while its block is still active.",
    "- Include AT MOST ONE 'idea' suggestion per run — a genuinely useful blind-spot idea outside the patterns above.",
    "- Keep titles short and actionable. Descriptions optional, one sentence.",
    "- If nothing is worth suggesting, return an empty suggestions array.",
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
    "Active projects (openTasks = open top-level tasks, datedTasks = how many of those have a due date, nextDue = earliest of those dates):",
    context.projects.length ? JSON.stringify(context.projects) : "none",
    "",
    "Blocked (on-hold) tasks:",
    blockedTasks.length ? JSON.stringify(blockedTasks) : "none",
    "",
    "Tasks needing a duration (overdue or due today, none set):",
    context.needsDuration.length ? JSON.stringify(context.needsDuration) : "none",
    "",
    `Feedback so far — per-kind counts: ${statLines}`,
    "Recent responses:",
    exampleLines,
  ].join("\n");

  const raw = await openaiJson({ system, user, schema: SUGGESTIONS_SCHEMA as unknown as Record<string, unknown> });

  // Duration estimates: only for ids we asked about, clamped and snapped to 5 minutes.
  const askedIds = new Set(context.needsDuration.map((t) => t.id));
  const estimates: { id: string; minutes: number }[] = [];
  const rawDurations = (raw as { durations?: unknown[] } | null)?.durations;
  for (const item of Array.isArray(rawDurations) ? rawDurations : []) {
    const d = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = typeof d.taskId === "string" ? d.taskId : "";
    const minutes = typeof d.minutes === "number" && Number.isFinite(d.minutes) ? d.minutes : NaN;
    if (!askedIds.has(id) || Number.isNaN(minutes)) continue;
    askedIds.delete(id); // first estimate per task wins
    estimates.push({ id, minutes: Math.min(240, Math.max(5, Math.round(minutes / 5) * 5)) });
  }
  // Estimates only size the suggested-time chips (30 min otherwise) — never lose the ideas over them.
  await setAiDurationEstimates(estimates).catch((err) => console.error("[suggestions] duration estimates not saved:", err));

  const list = (raw as { suggestions?: unknown[] } | null)?.suggestions;
  if (!Array.isArray(list)) return { created: 0, skipped: 0, durations: estimates.length };

  // Defensive coercion — never trust field shapes. Three gates, all enforced here rather than in
  // the prompt, because the model has repeatedly failed each of them:
  //   1. dedupeKey is *derived*, not accepted: one key per kind+event (or kind+day+title for a
  //      novel idea), so two phrasings of the same work collapse onto one row.
  //   2. a normalised kind+title index catches near-duplicates the key can't (same idea proposed
  //      against no event, or against two different events).
  //   3. suggestedDate is clamped forward to today — nothing lands in the past.
  const validEventIds = new Set(upcoming.map((e) => e.id));
  const validProjectIds = new Set(context.projects.map((p) => p.id));
  const openTitleKeys = new Set(openTitles.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()));
  const rows: Parameters<typeof createSuggestions>[0] = [];
  let skipped = 0;
  for (const item of list) {
    if (rows.length >= wanted) break; // the model was asked for `wanted`; never exceed it
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
      projectId: typeof s.projectId === "string" && validProjectIds.has(s.projectId) ? s.projectId : null,
      suggestedDate: proposedDate && proposedDate < todayKey ? todayKey : proposedDate,
    });
  }

  if (rows.length) await createSuggestions(rows);
  return { created: rows.length, skipped, durations: estimates.length };
}
