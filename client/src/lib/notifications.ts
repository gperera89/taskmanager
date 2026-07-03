import "server-only";
import webpush from "web-push";
import {
  deletePushSubscription,
  getActiveTopLevelRoutines,
  getPushSubscriptions,
  getUnnotifiedDueProjects,
  getUnnotifiedDueTasks,
  isRoutineTickedNow,
  markProjectNotified,
  markRoutineNotified,
  markTaskNotified,
  ROUTINE_TICK_EXPIRY_MS,
} from "@/lib/api";
import { isRoutineDueToday } from "@/lib/taskRecurrence";
import { dueInstant, pad2, PERTH_UTC_OFFSET_MS } from "@/lib/taskbookDates";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

// `tag` groups related notifications so a later push replaces an earlier one with the same
// tag instead of stacking (used to keep a routine cluster to a single notification). `close`
// tells the service worker to just close whatever notification already has `tag` rather than
// show a new one — see checkAndNotifyDueRoutines' 1-hour auto-dismiss.
type PushPayload = { title: string; body: string; url: string; tag?: string; close?: true };

async function sendToAllSubscriptions(payload: PushPayload) {
  const subscriptions = await getPushSubscriptions();
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser has unsubscribed or the endpoint expired — stop trying it.
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscription(sub.endpoint);
        } else {
          console.error("[notifications] push failed for", sub.endpoint, err);
        }
      }
    })
  );
}

// Perth wall-clock "now": PERTH_UTC_OFFSET_MS shifts the real instant so its UTC getters read
// as the local Perth clock face, matching the face-value-as-UTC convention used for due dates
// and routine reminderTime strings throughout this codebase.
function perthNow(at: Date): Date {
  return new Date(at.getTime() + PERTH_UTC_OFFSET_MS);
}

function perthDateKey(at: Date): string {
  const p = perthNow(at);
  return `${p.getUTCFullYear()}-${p.getUTCMonth()}-${p.getUTCDate()}`;
}

// The external scheduler is expected to hit /api/cron/check-due roughly once a minute; this is
// the tolerance window for the "auto-close an unactioned notification" check below, wide enough
// to absorb scheduler jitter without missing the moment. Closing an already-closed notification
// is a no-op, so a wider window risks harmless double-closes, not incorrect ones.
const CLOSE_CHECK_WINDOW_MS = 3 * 60 * 1000;

// Finds every routine cluster (a top-level routine plus its sub-routines) whose schedule and
// reminder time have arrived today and hasn't been notified about yet, sends ONE push per
// cluster naming every sub-routine so they read and dismiss together like "Wake Up Routine" ->
// "Make coffee · Brush teeth · Shave", and marks it notified so it won't re-fire today. Also
// finds clusters notified over an hour ago that were never ticked and closes their still-open
// notification (see the PushPayload.close comment) so a stale reminder doesn't linger forever.
async function checkAndNotifyDueRoutines(now: Date): Promise<{ notified: number; closed: number }> {
  const local = perthNow(now);
  const nowHHMM = `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}`;

  const routines = await getActiveTopLevelRoutines();

  const due = routines.filter((r) => {
    if (isRoutineTickedNow(r)) return false;
    if (r.notifiedAt && perthDateKey(r.notifiedAt) === perthDateKey(now)) return false;
    if (nowHHMM < r.reminderTime) return false;
    return isRoutineDueToday(r, local);
  });

  const toClose = routines.filter((r) => {
    if (!r.notifiedAt || isRoutineTickedNow(r)) return false;
    const age = now.getTime() - r.notifiedAt.getTime();
    return age >= ROUTINE_TICK_EXPIRY_MS && age < ROUTINE_TICK_EXPIRY_MS + CLOSE_CHECK_WINDOW_MS;
  });

  await Promise.all([
    ...due.map(async (r) => {
      const tag = `routine-${r.id}`;
      const body = r.subroutines.length ? r.subroutines.map((s) => s.title).join(" · ") : "Tap to mark done";
      await sendToAllSubscriptions({ title: r.title, body, url: "/", tag });
      await markRoutineNotified(r.id, now);
    }),
    ...toClose.map((r) => sendToAllSubscriptions({ title: r.title, body: "", url: "/", tag: `routine-${r.id}`, close: true })),
  ]);

  return { notified: due.length, closed: toClose.length };
}

// Finds every task/project/routine cluster that has come due and hasn't been notified about
// yet, sends a push to every registered device, and marks each as notified so it won't re-fire.
// Meant to be called on a short interval (e.g. every minute) by an external scheduler hitting
// /api/cron/check-due, since Vercel Hobby cron can't run that often.
export async function checkAndNotifyDueItems(): Promise<{
  tasksNotified: number;
  projectsNotified: number;
  routinesNotified: number;
  routinesClosed: number;
}> {
  const now = new Date();
  const until = new Date(now.getTime() + PERTH_UTC_OFFSET_MS);

  const [tasks, projects, routineResult] = await Promise.all([
    getUnnotifiedDueTasks(until),
    getUnnotifiedDueProjects(until),
    checkAndNotifyDueRoutines(now),
  ]);
  const dueTasks = tasks.filter((t) => t.dueDate && dueInstant(t.dueDate) <= now);
  const dueProjects = projects.filter((p) => p.dueDate && dueInstant(p.dueDate) <= now);

  await Promise.all([
    ...dueTasks.map(async (t) => {
      await sendToAllSubscriptions({ title: "Task due", body: t.title, url: "/" });
      await markTaskNotified(t.id, now);
    }),
    ...dueProjects.map(async (p) => {
      await sendToAllSubscriptions({ title: "Project due", body: p.name, url: "/" });
      await markProjectNotified(p.id, now);
    }),
  ]);

  return {
    tasksNotified: dueTasks.length,
    projectsNotified: dueProjects.length,
    routinesNotified: routineResult.notified,
    routinesClosed: routineResult.closed,
  };
}
