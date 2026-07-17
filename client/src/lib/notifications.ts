import "server-only";
import {
  completeRoutineCluster,
  getCronSnapshot,
  isRoutineTickedNow,
  markCountdownNotified,
  markProjectNotified,
  markTaskNotified,
  sweepDayPlanBlocks,
  sweepDismissedCalendarEvents,
  sweepPastCountdowns,
  type CronRoutine,
  type CronCountdown,
} from "@/lib/api";
import { countdownYears, nextCountdownOccurrenceMs, MS_PER_DAY } from "@/lib/shared";
import { isRoutineDueToday } from "@/lib/taskRecurrence";
import { calendarDateFromDue, dueInstant, formatShortDate, pad2, zonedNow } from "@/lib/taskbookDates";

// --- Delivery layer -------------------------------------------------------------------------
//
// Single channel: ntfy (https://ntfy.sh) — a real push app on iOS/Android/desktop with
// reliable APNs/FCM delivery and a persistent per-topic history, so a notification survives
// as a record even after the app auto-ticks the routine it announced. Configure with:
//   NTFY_TOPIC   (required to enable; treat as a secret — anyone who knows it can read/send)
//   NTFY_SERVER  (optional, defaults to https://ntfy.sh — set for a self-hosted instance)
//   NTFY_TOKEN   (optional, for reserved topics)
//   APP_URL      (optional, absolute URL the notification's tap/click opens)
//
// The old Web Push channel (VAPID + per-device PushSubscription rows) is GONE: with both
// channels live every reminder arrived twice on the phone, and ntfy was the one delivering
// reliably (iOS silently revokes PWA push subscriptions it considers abusive).

type NotifyAction = {
  label: string;
  // Path under APP_URL the button POSTs to (an /api/notify-action variant). The request
  // carries the cron secret so ntfy's button can authenticate without a session.
  path: string;
};

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  actions?: NotifyAction[];
};

function appUrl(path: string): string {
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

// ntfy action buttons ride in a single "Actions" header:
//   http, <label>, <url>, method=POST, headers.Authorization=Bearer <secret>
// Commas/semicolons are ntfy's delimiters, so labels are kept to safe words.
function ntfyActionsHeader(actions: NotifyAction[]): string {
  const secret = process.env.CRON_SECRET ?? "";
  return actions
    .map((a) => `http, ${a.label}, ${appUrl(a.path)}, method=POST, headers.Authorization=Bearer ${secret}`)
    .join("; ");
}

export async function deliver(payload: PushPayload): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");
  const headers: Record<string, string> = {
    // Non-ASCII in header values breaks fetch; ntfy reads UTF-8 titles from this RFC 2047-free
    // fallback fine for this app's plain-English titles, but strip anything unsafe defensively.
    Title: payload.title.replace(/[^\x20-\x7e]/g, "").slice(0, 250) || "Reminder",
    Priority: "default",
    Tags: "spiral_calendar",
  };
  const click = appUrl(payload.url);
  if (click.startsWith("http")) headers.Click = click;
  // Cura's logo as the notification icon (Android; iOS always shows the ntfy app icon).
  // /icon.png is exempted from the auth proxy (see proxy.ts) so ntfy clients can fetch it.
  const icon = appUrl("/icon.png");
  if (icon.startsWith("http")) headers.Icon = icon;
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  if (payload.actions?.length && process.env.CRON_SECRET) headers.Actions = ntfyActionsHeader(payload.actions);

  const res = await fetch(`${server}/${topic}`, { method: "POST", body: payload.body, headers });
  if (!res.ok) console.error("[notifications] ntfy publish failed:", res.status, await res.text().catch(() => ""));
}

// --- Due checks (called by /api/cron/check-due) ----------------------------------------------

function zonedDateKey(at: Date, timeZone: string): string {
  const z = zonedNow(at.getTime(), timeZone);
  return `${z.getUTCFullYear()}-${z.getUTCMonth()}-${z.getUTCDate()}`;
}

// The longest configurable reminder lead — widens the over-fetch window so a "1 day before"
// reminder is still picked up by the dueDate <= until query.
const MAX_LEAD_MS = 24 * 60 * 60 * 1000;
// Stored due dates are face-value clock times up to a timezone offset ahead of the real UTC
// instant. The snapshot query runs before we know the configured zone (the zone comes back IN
// the snapshot), so over-fetch by the largest offset on Earth (UTC+14) — the precise
// dueInstant(due, timeZone) <= now check below never misses or double-fires either way.
const MAX_TZ_OFFSET_MS = 14 * 60 * 60 * 1000;

// Finds every routine cluster (a top-level routine plus its sub-routines) whose schedule and
// reminder time have arrived today and hasn't fired yet, sends ONE notification per cluster
// naming every sub-routine, and AUTO-TICKS the cluster: the routine completes itself the
// moment it's announced, while the notification persists in ntfy's history as the record.
// The notification carries a "Not done" action button that un-ticks it for routines the user
// didn't actually do (see /api/notify-action).
async function notifyDueRoutines(routines: CronRoutine[], now: Date, timeZone: string): Promise<{ notified: number }> {
  const local = zonedNow(now.getTime(), timeZone);
  const nowHHMM = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;

  const due = routines.filter((r) => {
    if (isRoutineTickedNow(r)) return false;
    if (r.notifiedAt && zonedDateKey(r.notifiedAt, timeZone) === zonedDateKey(now, timeZone)) return false;
    if (nowHHMM < r.reminderTime) return false;
    // Skip every occurrence strictly before a "paused until" date (e.g. a holiday break);
    // compare as UTC-midnight instants, not strings, since date-string ordering isn't numeric.
    if (r.pausedUntil) {
      const todayUTC = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
      const pausedUTC = Date.UTC(r.pausedUntil.getUTCFullYear(), r.pausedUntil.getUTCMonth(), r.pausedUntil.getUTCDate());
      if (todayUTC < pausedUTC) return false;
    }
    return isRoutineDueToday(r, local);
  });

  await Promise.all(
    due.map(async (r) => {
      const body = r.subroutineTitles.length ? r.subroutineTitles.join(" · ") : "Ticked off automatically";
      await deliver({
        title: r.title,
        body,
        url: "/",
        tag: `routine-${r.id}`,
        actions: [{ label: "Not done", path: `/api/notify-action?kind=untick-routine&id=${r.id}` }],
      });
      // Auto-tick: stamps lastCompletedAt + notifiedAt on the whole cluster and writes the
      // CompletionLog row flagged auto=true.
      await completeRoutineCluster(r.id, true);
    })
  );

  return { notified: due.length };
}

// Countdown pushes fire once the local morning has arrived, not at midnight.
const COUNTDOWN_NOTIFY_TIME = "08:00";
// How far ahead the heads-up push fires ("plus a heads-up" — time to buy the present).
const COUNTDOWN_HEADS_UP_DAYS = 7;

// Important-event countdowns: one heads-up push a week out and one on the morning of the day,
// each sent exactly once per occurrence (the notified* markers store which occurrence fired;
// editing the event clears them). Yearly events name the elapsed years ("42 years today").
async function notifyDueCountdowns(countdowns: CronCountdown[], now: Date, timeZone: string): Promise<{ notified: number }> {
  const local = zonedNow(now.getTime(), timeZone);
  const nowHHMM = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;
  if (nowHHMM < COUNTDOWN_NOTIFY_TIME) return { notified: 0 };

  const todayUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let notified = 0;

  await Promise.all(
    countdowns.map(async (c) => {
      const occMs = nextCountdownOccurrenceMs(c.date, c.repeatsYearly, todayUtc);
      if (occMs < todayUtc) return; // a passed one-off, awaiting sweep
      const occurrence = new Date(occMs);
      const daysAway = Math.round((occMs - todayUtc) / MS_PER_DAY);
      const years = countdownYears(c.date, occMs);
      const yearsLabel = c.repeatsYearly && years > 0 ? `${years} ${years === 1 ? "year" : "years"}` : null;

      if (daysAway === 0 && c.notifiedOnDayFor?.getTime() !== occMs) {
        await deliver({
          title: `Today: ${c.title}`,
          body: yearsLabel ? `${yearsLabel} today 🎉` : "The day is here 🎉",
          url: "/",
          tag: `countdown-${c.id}`,
        });
        await markCountdownNotified(c.id, "onDay", occurrence);
        notified++;
      } else if (daysAway > 0 && daysAway <= COUNTDOWN_HEADS_UP_DAYS && c.notifiedHeadsUpFor?.getTime() !== occMs) {
        const dateLabel = formatShortDate(calendarDateFromDue(occurrence));
        await deliver({
          title: `${c.title} in ${daysAway} ${daysAway === 1 ? "day" : "days"}`,
          body: yearsLabel ? `${yearsLabel} on ${dateLabel}` : `On ${dateLabel}`,
          url: "/",
          tag: `countdown-${c.id}`,
        });
        await markCountdownNotified(c.id, "headsUp", occurrence);
        notified++;
      }
    })
  );

  return { notified };
}

// Finds every task/project that has reached its reminder instant (due time minus its optional
// reminderLeadMinutes) and hasn't been notified, sends a notification, and marks it notified.
// Meant to be called on a short interval (e.g. every minute) by an external scheduler hitting
// /api/cron/check-due — the snapshot query's heartbeat stamp is how the UI detects when that
// scheduler lapses.
//
// Database-frugality note (Prisma Postgres free tier caps operations/month): the entire
// common path — heartbeat write + all four reads — is ONE query (getCronSnapshot), and the
// housekeeping sweeps run only on the first cron hit of each local day. Anything beyond that
// single operation happens only in the rare minutes when something actually comes due.
export async function checkAndNotifyDueItems(): Promise<{
  tasksNotified: number;
  projectsNotified: number;
  routinesNotified: number;
  countdownsNotified: number;
  sweptDaily: boolean;
}> {
  const now = new Date();
  const until = new Date(now.getTime() + MAX_TZ_OFFSET_MS + MAX_LEAD_MS);
  const snap = await getCronSnapshot(now, until);
  const { timeZone } = snap;

  // Daily housekeeping (retention sweeps that used to run on every cron hit): only on the
  // first run of each local calendar day, detected via the previous heartbeat stamp.
  const sweptDaily = !snap.lastCronAt || zonedDateKey(snap.lastCronAt, timeZone) !== zonedDateKey(now, timeZone);
  if (sweptDaily) {
    await Promise.all([sweepDismissedCalendarEvents(), sweepDayPlanBlocks(), sweepPastCountdowns(now)]);
  }

  const reminderInstant = (due: Date, leadMinutes: number | null) =>
    new Date(dueInstant(due, timeZone).getTime() - (leadMinutes ?? 0) * 60_000);

  const dueTasks = snap.tasks.filter((t) => reminderInstant(t.dueDate, t.reminderLeadMinutes) <= now);
  const dueProjects = snap.projects.filter((p) => reminderInstant(p.dueDate, p.reminderLeadMinutes) <= now);

  const [routineResult, countdownResult] = await Promise.all([
    notifyDueRoutines(snap.routines, now, timeZone),
    notifyDueCountdowns(snap.countdowns, now, timeZone),
    ...dueTasks.map(async (t) => {
      await deliver({
        title: t.reminderLeadMinutes ? "Task coming up" : "Task due",
        body: t.title,
        url: "/",
        tag: `task-${t.id}`,
        actions: [{ label: "Snooze 1 day", path: `/api/notify-action?kind=snooze-task&id=${t.id}&days=1` }],
      });
      await markTaskNotified(t.id, now);
    }),
    ...dueProjects.map(async (p) => {
      await deliver({
        title: p.reminderLeadMinutes ? "Project deadline coming up" : "Project due",
        body: p.name,
        url: "/",
        tag: `project-${p.id}`,
      });
      await markProjectNotified(p.id, now);
    }),
  ]);

  return {
    tasksNotified: dueTasks.length,
    projectsNotified: dueProjects.length,
    routinesNotified: routineResult.notified,
    countdownsNotified: countdownResult.notified,
    sweptDaily,
  };
}
