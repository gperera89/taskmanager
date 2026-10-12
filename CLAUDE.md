# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

The app lives in `client/`, a Next.js (App Router) project. `obsidian-plugin/` is the Cura Bridge
Obsidian plugin that mirrors notes into the vault (see "Obsidian vault bridge" below); it has its
own `package.json` and is built and installed separately.

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
captured entity). `Task` and `Routine` both self-relate for subtasks/sub-routines
(`onDelete: Cascade`).

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
  when the action resolves. Edits go through a durable IndexedDB outbox, and the raw state is
  snapshotted to IndexedDB too. **Start-up** draws the static `AppFrame` until the store has picked
  its rows (`ready`): the device snapshot wins over the page HTML whenever that HTML came from the
  service worker's cache (the norm once installed), ops are queued, or the device is offline — so
  the app paints once, from the best rows, with the right phone/desktop layout. **Sync** is one
  server action, `pullState(knownVersion)`: it checks an md5 of every row the page reads
  (`STATE_FINGERPRINT_SQL` in `api.ts`, computed inside Postgres) and returns either "unchanged"
  or the full rows, which the store swaps in without a page re-render. It runs after start-up, on
  focus/visibility, on a 3-minute poll while visible, and after a rejected write; it never
  overwrites rows while ops are queued or a local edit landed mid-flight.
  `AppSettings.lastCronAt` is excluded from the hash (it moves every minute) and rides along in
  the response instead. Anything the page shows that an unchanged sync would leave stale must
  therefore be computed client-side — that's why the header's date label is.
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

### Notifications (Web Push, ntfy fallback)
`src/lib/notifications.ts` (`server-only`) decides what's due; `deliver()` sends each reminder on
exactly ONE channel. First Web Push (`src/lib/push.ts`, VAPID keys `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/
`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`) to every live `PushSubscription` row; only if no device took
it does it fall back to an [ntfy](https://ntfy.sh) topic (`NTFY_TOPIC`/`NTFY_SERVER`/`NTFY_TOKEN`;
`Actions` headers carry the cron secret so ntfy's buttons can hit `/api/notify-action`). The two
used to fire together and double-deliver — don't reintroduce that. iOS silently revokes home-screen
app subscriptions now and then: a 404/410 marks the row `failedAt`, the reminder falls back to
ntfy, and the device re-registers on its next open (`src/lib/pushClient.ts`, at most daily; a
"dead" answer makes it resubscribe). `public/sw.js` shows every push (it must — iOS revokes apps
whose pushes show nothing) and routes taps: a button posts to `/api/notify-action` with the
session cookie; a plain tap opens `/?open=task:<id>`/`routine:<id>`, which `ReminderSheet.tsx`
turns into Done/Tomorrow — iOS can't put buttons on web-app notifications. `/api/cron/check-due`
(`src/app/api/cron/check-due/route.ts`) is hit by an **external** scheduler on a short interval
(Vercel Hobby's own Cron is capped at once/day, too coarse), authenticated by a `CRON_SECRET`
bearer token rather than a user session.

**Database-operations budget:** the hosted Prisma Postgres free tier meters ~100k operations/month,
and a once-a-minute cron multiplies every query by ~43k/month. The cron's whole common path is
therefore ONE raw-SQL operation (`getCronSnapshot` in `api.ts`: heartbeat-stamping CTE + all due
reads as JSON aggregates), with retention sweeps gated to the first run of each local day. Keep it
that way: don't add per-run queries to the cron path, and prefer batching/piggybacking reads for
anything that runs on a schedule.

### Notes
`Note` rows are freeform Markdown, optionally attached to a project (`onDelete: SetNull` — a
deleted project's notes become Unfiled). The Notes tab (`NotesView.tsx`) lists them; a note opens
full-screen in `NotePage.tsx` with the project's `ProjectCard` beside it (a bottom sheet on
phones). The body editor is CodeMirror 6 (`MarkdownEditor.tsx`, loaded via `next/dynamic`) so the
Markdown round-trips byte-for-byte — this is groundwork for mirroring notes into the Obsidian
vault's `Projects/` folder. Note ids are minted client-side (`crypto.randomUUID`) so the editor can
save straight after a create without a temp-id swap; `createNote` upserts to stay idempotent
under outbox retries. Body edits are saved on a ~1.2s debounce (one queued write each), and an
incoming server copy only replaces the editor's text when nothing local is unsaved.

**Checkbox lines are tasks.** `- [ ] text` in a note becomes a task (in the note's project, or
standalone if Unfiled), linked by an Obsidian block id appended to the line (`^cura-k3x9q2`,
stored as `Task.noteBlockId`; hidden in Cura's editor). `src/lib/noteTasks.ts` is the shared,
client-safe logic (parse, assign ids, plan the sync, edit a line by block id). The server is
authoritative: `saveNoteBody` in `api.ts` creates/renames/ticks tasks from the body, and
`toggleTaskCompletion`/`updateTask`/`deleteTask` edit the linked line back — so every path that
touches a task (MCP, notification actions, voice) keeps its note in step. The store mirrors both
directions optimistically and sends the ids of tasks it created as hints, so client and server
rows match without a swap. A removed line never deletes its task server-side; the app warns
(toast with "Keep task") and deletes after the undo window. Edits to an open note made from
elsewhere in the app reach the editor via `subscribeNoteEdits` rather than raw state, since the
editor holds unsaved text the store hasn't seen.

### Obsidian vault bridge
`obsidian-plugin/` keeps a Markdown file per note in the Obsidian vault — `Projects/Project — <Name>
<YYYY-MM>/<Title>.md`, completed projects under `Archives/`, unattached notes in
`Projects/_Unfiled/` — and syncs edits both ways through `api/vault-sync` (bearer
`VAULT_SYNC_SECRET`; exempt from the proxy). Cura is the source of truth; a file is tied to its
note by `cura-note:` in its frontmatter, and the plugin touches no other files except new ones
started inside those folders (imported as notes). It polls a one-operation version fingerprint
(`getVaultVersion`) and pulls the whole snapshot only when it moves. Saves carry the
`updatedAt` they were based on; if Cura changed since, the server answers 409 and the plugin
keeps Obsidian's text as a "(conflict …)" copy. Renaming a file renames the note, moving it
between Cura folders changes its project, deleting it deletes the note (its tasks stay).
The sync engine (`src/core.ts`) has no Obsidian imports; `npm test` there runs it end-to-end
against a running Cura and a temp folder. Build with `npm run build`, then copy `main.js` and
`manifest.json` into the vault's `.obsidian/plugins/cura-bridge/`. It's desktop-only: one Mac
syncs, and Obsidian Sync carries the files to other devices.

### Voice capture
`Header.tsx`'s mic button records audio client-side and posts it to
`/api/voice-capture` (`src/app/api/voice-capture/route.ts`), which transcribes it with Whisper and
classifies it with `gpt-4o-mini` into a Task/Project/Routine/Habit (`src/lib/voice.ts`), creates the
entity immediately, and leaves a `VoiceCapture` row as an unread notice (surfaced in `Header.tsx`'s
notification panel; dismissing or editing it deletes the row). This route accepts either a normal
Google session *or* an `X-Shortcut-Secret` header, since the iPhone Shortcut integration can't hold
a login cookie.

### Habit log (Stoic journal)
`/api/habit-log/<habitId>` (`src/app/api/habit-log/[id]/route.ts`): POST ticks a habit via `completeHabit`, GET only checks the link.
The Stoic journal (stoic.cura-gp.app, a separate private repo) calls it from the browser after an
entry is saved, so it authenticates with `Authorization: Bearer $HABIT_LOG_SECRET` and answers CORS
only for `HABIT_LOG_ORIGINS` (comma-separated, default `https://stoic.cura-gp.app`). Keep it
content-free: the journal's privacy model allows Cura to learn "journaled today", nothing more.

### Calendar sync
`src/lib/calendar.ts` (`server-only`) is a read-only sync from ICS feed URLs
(`GMAIL_CALENDAR_ICS_URL`/`OUTLOOK_CALENDAR_ICS_URL`), cached 5 minutes via `unstable_cache`
independent of task/project/etc. mutations (a plain per-mutation revalidate would otherwise redo
~1000+ events' worth of fetching/parsing on every button press).
