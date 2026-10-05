import { timingSafeEqual } from "node:crypto";
import { completeHabit, getHabit } from "@/lib/api";

// Lets another of my apps tick a habit for me — the Stoic journal (stoic.cura-gp.app) calls this
// from the browser after an entry is saved. Like api/cron it's a machine caller, so it
// authenticates with a shared secret (HABIT_LOG_SECRET) instead of a Google session, and it's
// exempt from the proxy's sign-in redirect. Being cross-origin, it answers CORS for the origins in
// HABIT_LOG_ORIGINS only. POST ticks the habit (the body is ignored: it carries nothing but
// "done now"); GET only checks the secret and habit, so the journal can test the link.
const DEFAULT_ORIGINS = "https://stoic.cura-gp.app";

function corsHeaders(request: Request): Record<string, string> {
  const allowed = (process.env.HABIT_LOG_ORIGINS ?? DEFAULT_ORIGINS).split(",").map((o) => o.trim());
  const origin = request.headers.get("origin");
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function authorized(request: Request) {
  // Same guard as api/cron: an unset secret must never match "Bearer undefined".
  const secret = process.env.HABIT_LOG_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

type Ctx = { params: Promise<{ id: string }> };

// Every answer, errors included, carries the CORS headers so the journal can read what went wrong.
async function handle(request: Request, act: () => Promise<Record<string, unknown> | null>) {
  const headers = corsHeaders(request);
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  try {
    const body = await act();
    if (!body) return Response.json({ error: "Habit not found" }, { status: 404, headers });
    return Response.json({ ok: true, ...body }, { headers });
  } catch (err) {
    if (err instanceof Error && err.message === "Habit not found") {
      return Response.json({ error: "Habit not found" }, { status: 404, headers });
    }
    return Response.json({ error: "Server error" }, { status: 500, headers });
  }
}

export function GET(request: Request, { params }: Ctx) {
  return handle(request, async () => {
    const habit = await getHabit((await params).id);
    return habit && { title: habit.title };
  });
}

export function POST(request: Request, { params }: Ctx) {
  return handle(request, async () => {
    await completeHabit((await params).id);
    return {};
  });
}
