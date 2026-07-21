import "server-only";
import ical from "node-ical";
import type { EventInstance, ParameterValue } from "node-ical";
import { unstable_cache } from "next/cache";
import type { CalendarEvent } from "@/components/taskbook/types";

export type { CalendarEvent };

function paramValueToString(value: ParameterValue | undefined): string | null {
  if (value === undefined) return null;
  return typeof value === "string" ? value : value.val;
}

// Read-only sync from ICS feeds, e.g. Google/Outlook's "secret address" links. Wide enough to
// cover the month-navigation view browsing a month or two ahead — feeds only carry upcoming
// instances, so browsing backward in time never shows ICS events, only task/project due dates.
const CALENDAR_WINDOW_DAYS = 60;

function getCalendarSources() {
  return [
    { id: "gmail", label: "Gmail", url: process.env.GMAIL_CALENDAR_ICS_URL },
    { id: "outlook", label: "Outlook", url: process.env.OUTLOOK_CALENDAR_ICS_URL },
  ].filter((source): source is { id: string; label: string; url: string } => Boolean(source.url));
}

async function getSourceEvents(
  source: { id: string; label: string; url: string },
  from: Date,
  to: Date
): Promise<CalendarEvent[]> {
  const calendar = await ical.async.fromURL(source.url);
  const instances: EventInstance[] = [];
  for (const component of Object.values(calendar)) {
    if (!component || component.type !== "VEVENT") continue;
    instances.push(...ical.expandRecurringEvent(component, { from, to }));
  }

  return instances.map((instance) => ({
    id: `${source.id}-${instance.event.uid}-${instance.start.toISOString()}`,
    title: paramValueToString(instance.summary) || "Untitled event",
    start: instance.start.toISOString(),
    end: instance.end.toISOString(),
    allDay: instance.isFullDay,
    location: paramValueToString(instance.event.location),
    source: source.label,
  }));
}

// Fetches every configured calendar independently so one broken feed doesn't blank out the rest.
async function fetchCalendarEvents(): Promise<{ events: CalendarEvent[]; errors: string[] }> {
  const sources = getCalendarSources();
  if (sources.length === 0) {
    return {
      events: [],
      errors: ["Calendar not configured: set GMAIL_CALENDAR_ICS_URL and/or OUTLOOK_CALENDAR_ICS_URL in .env.local"],
    };
  }

  const from = new Date();
  const to = new Date(from.getTime() + CALENDAR_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const results = await Promise.allSettled(sources.map((source) => getSourceEvents(source, from, to)));

  const events: CalendarEvent[] = [];
  const errors: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      events.push(...result.value);
    } else {
      console.error(`Calendar source "${sources[i].label}" failed:`, result.reason);
      errors.push(`${sources[i].label}: could not fetch calendar feed`);
    }
  });
  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  return { events, errors };
}

// Tag so the "refresh calendar" button can expire this entry on demand (see
// refreshCalendarFeeds in app/actions.ts) without waiting out the 5-minute window.
export const CALENDAR_CACHE_TAG = "calendar-events";

// Cached independently of task/habit/project/routine mutations: those call revalidatePath("/"),
// which would otherwise force this (two live network fetches + parsing ~1000+ events) to redo
// on every single button press. A 5-minute staleness window is fine for a read-only sync.
export const getCalendarEvents = unstable_cache(fetchCalendarEvents, ["calendar-events"], {
  revalidate: 300,
  tags: [CALENDAR_CACHE_TAG],
});
