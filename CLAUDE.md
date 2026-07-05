# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

This repo is a thin wrapper around a single app: everything lives in `client/`, a Next.js (App
Router) project. There is nothing at the repo root except this file and `client/`.

**Read `client/AGENTS.md` before writing any code that touches Next.js APIs.** This project is
pinned to a Next.js version newer than most training data — conventions differ from what you'd
expect (e.g. middleware is `client/src/proxy.ts`, not `middleware.ts`). When in doubt, check
`client/node_modules/next/dist/docs/` rather than assuming.

## Commands

Run everything from `client/`:

- `npm run dev` — start the dev server (Turbopack). This app is single-user and normally has a
  long-lived dev server already running against a live hosted Postgres — see "Database" below
  before running build/schema commands.
- `npm run lint` — ESLint (`eslint-config-next`, flat config in `eslint.config.mjs`).
- `npx tsc --noEmit` — typecheck. Prefer this over `npm run build` for verification (see below).
- `npm run build` — `prisma generate && next build`. Avoid running this while a dev server is
  already up against the same directory: it can transiently corrupt the dev server's `.next`
  cache/HMR state until the dev server's own watcher recompiles.
- There is no test suite / test runner configured in this project.

### Database (Prisma + hosted Postgres)

- No migrations folder — schema changes are applied live: edit `client/prisma/schema.prisma`,
  then `npx prisma generate && npx prisma db push`.
- `db push` writes directly to the real, shared hosted Postgres (`db.prisma.io`, via
  `DATABASE_URL` in `client/.env.local`) — there is no separate dev/staging database. Standalone
  scripts that open their own connection should clean up any rows they create.

## Architecture

### Auth
Single-user app gated by Google OAuth — only one hardcoded email may sign in (`ALLOWED_EMAILS` in
`src/auth.ts`). Route protection is `src/proxy.ts` (this Next.js version's replacement for
`middleware.ts`), which redirects unauthenticated requests to sign-in except for
`/api/auth`, `/api/cron`, and `/api/voice-capture` (those three do their own auth — see below).

### Data layer
`src/lib/db.ts` is the only Prisma client instance (pooled via `@prisma/adapter-pg`, reused across
hot reloads). `src/lib/api.ts` (`server-only`) is the *only* place that calls `prisma.*` directly —
all reads/writes for every entity go through its exported functions. `src/app/actions.ts`
(`"use server"`) is a thin `FormData`-parsing wrapper around `api.ts`, called by the client store.

Entities (`prisma/schema.prisma`): `Task`, `Project`, `Habit`, `Routine`, `Category` (free-text
options for `Task.category`, not a foreign key), `VoiceCapture` (unread notice pointing at a
captured entity), `PushSubscription`. `Task` and `Routine` both self-relate for
subtasks/sub-routines (`onDelete: Cascade`).

**Recurrence** is one shared rule shape (`TaskRepeatRule` in `src/lib/taskRecurrence.ts`) used by
two different entities with different semantics:
- `Task.repeat*` fields: a single concrete `dueDate` that rolls forward in place on completion
  (`nextOccurrence`) — no history rows.
- `Routine`: no anchor date, just "is today a match" (`isRoutineDueToday`) — `interval` (every N
  weeks/months) is intentionally ignored for the due-today check since there's no cycle to count
  from. `Routine.pausedUntil` skips occurrences before a given date (e.g. a holiday break);
  `nextRoutineOccurrence` computes the next *upcoming* (always ≥ tomorrow) match for display.
- Sub-routines carry a copy of their parent's schedule fields but those are never read directly —
  only top-level routines (`parentId: null`) are checked for due-today/notifications; a cluster
  (parent + sub-routines) ticks and notifies as one unit.

### Date/time encoding (read this before touching any due-date/scheduling code)
Due dates are stored as **UTC midnight of the chosen calendar date** with a clock time layered on
top at face value — not a real timezone conversion, just the literal `HH:MM` the user picked
(`combineDueDateTime` in `api.ts`). Comparisons throughout the app read the stored value's
`getUTC*()` getters as if they were local calendar fields (`taskbookDates.ts`). Reminder/due clock
times are entered in Australia/Perth (UTC+8, no DST); `PERTH_UTC_OFFSET_MS` /
`dueInstant()`/`perthNow()`-style helpers convert the face-value stored time into the real UTC
instant for the notification cron. If you add new date logic, follow whichever existing helper
matches what you're comparing — don't reach for `new Date()`'s local getters directly.

### Optimistic client store (the core of the UI)
The whole taskbook UI is one client-side store, not per-mutation server round trips (this replaced
an earlier `revalidatePath`-per-action design that had an ~8s click-to-update lag):
- `src/lib/derive.ts` — pure, client-safe `deriveEntities(raw, nowMs)`. Single source of truth
  that turns raw Prisma-shaped rows into the grouped/bucketed/ranked view-models the UI renders.
  Runs both server-side (initial SSR in `page.tsx`) and client-side (after every optimistic edit),
  so a local edit re-buckets/re-counts/re-labels exactly as a server round trip would have. Because
  it can't import `server-only` code, it duplicates a handful of small constants/helpers from
  `api.ts`/`notifications.ts` — keep those in sync if you change the originals.
- `src/components/taskbook/store.tsx` — `StoreProvider`/`useTaskbook()`. Holds raw entity state,
  exposes typed mutation methods. Each method patches local state immediately, then fires the
  matching server action in the background; creates insert a `tmp-…` id and swap in the real one
  when the action resolves. On any write error, or when the tab regains focus/visibility, it
  `router.refresh()`s to reconcile with server truth (this also picks up voice captures and other
  devices' edits, at the cost of those not appearing until a focus event).
- `src/components/taskbook/formParse.ts` — client-side `FormData` → typed input parsers mirroring
  the ones in `app/actions.ts`, so forms keep plain `name=` attributes but feed the optimistic store.
- `src/app/page.tsx` fetches raw rows server-side and computes only the calendar rail (month
  cells/day details/"upcoming") — that part is NOT optimistic, stays server-computed, refreshes on
  focus. Everything else is handed to `<StoreProvider initialRaw serverData nowMs>`.

When adding a new mutable field: extend the Prisma schema → `api.ts` (server) → `actions.ts`
(server action) → `store.tsx` (optimistic patch + action call, add to `TaskbookActions`) →
`derive.ts`/`types.ts` (view-model) → the view component. Skipping the optimistic-store step means
the UI won't update until the next focus-triggered refresh.

### View layer
`src/components/taskbook/TaskbookApp.tsx` is the shell: owns the active tab (`AreaKey`), the
Add/Edit modal state, and the mobile/desktop split (swipeable carousel below the 1024px `lg`
breakpoint, fixed content + calendar side rail above it — this is a `matchMedia` JS check, separate
from Tailwind's own breakpoints used for finer-grained CSS elsewhere). `ModalContext` exposes
`openAdd`/`openEdit`; `ItemModal.tsx` renders all four add/edit forms (Task/Project/Routine/Habit)
— tasks are only ever *created* there, since editing an existing task happens inline on its row
(`TasksView.tsx`'s `TaskRow`, also reused inside `ProjectsView.tsx`'s project cards).

### Notifications (Web Push)
`src/lib/notifications.ts` (`server-only`) sends Web Push via `web-push`, keyed off VAPID env vars.
`/api/cron/check-due` (`src/app/api/cron/check-due/route.ts`) is hit by an **external** scheduler
on a short interval (Vercel Hobby's own Cron is capped at once/day, too coarse), authenticated by a
`CRON_SECRET` bearer token rather than a user session. Routine clusters use a `tag` per top-level
routine so a later push replaces rather than stacks, plus a "silent push then immediately close by
tag" trick (`public/sw.js`) to auto-dismiss an unactioned routine reminder after an hour, since Web
Push has no real notification TTL. `NotificationSetup.tsx` handles subscribe/unsubscribe from the
client (iOS requires the PWA be added to the home screen first — plain Safari tabs can't receive
push at all).

### Voice capture
`Header.tsx`'s mic button records audio client-side and posts it to
`/api/voice-capture` (`src/app/api/voice-capture/route.ts`), which transcribes it with Whisper and
classifies it with `gpt-4o-mini` into a Task/Project/Routine/Habit (`src/lib/voice.ts`), creates the
entity immediately, and leaves a `VoiceCapture` row as an unread notice (surfaced in `Header.tsx`'s
notification panel; dismissing or editing it deletes the row). This route accepts either a normal
Google session *or* an `X-Shortcut-Secret` header, since the iPhone Shortcut integration can't hold
a login cookie.

### Calendar sync
`src/lib/calendar.ts` (`server-only`) is a read-only sync from ICS feed URLs
(`GMAIL_CALENDAR_ICS_URL`/`OUTLOOK_CALENDAR_ICS_URL`), cached 5 minutes via `unstable_cache`
independent of task/project/etc. mutations (a plain per-mutation revalidate would otherwise redo
~1000+ events' worth of fetching/parsing on every button press).
