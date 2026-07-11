# Cura — Audit & Improvement Plan

Audit date: 2026-07-11. This document is written to be executable step-by-step by a coding
model. Every item names the files to touch. For any new persisted field, ALWAYS follow the
repo's field-chain recipe (see `CLAUDE.md`):
`prisma/schema.prisma` → `src/lib/api.ts` → `src/app/actions.ts` → `src/components/taskbook/store.tsx`
→ `src/lib/derive.ts` + `src/components/taskbook/types.ts` → view component. Skipping the
store step means the UI won't update until the next focus refresh.

---

## Part 1 — Audit findings

### 1A. Bugs / correctness (fix first — Phase 0)

1. **Subtasks are write-only.** The data model and `ItemModal`/`addTask` can create subtasks
   (`parentId`), but `TasksView.tsx` renders them only as a "2 of 5 subtasks" progress bar —
   there is no way to see, toggle, rename, or delete an individual subtask anywhere in the UI.
   `store.tsx`'s `mapTask` only patches top-level tasks, so even a wired-up toggle would fail
   optimistically. Fix: expandable subtask list under `TaskRow` with checkboxes + delete;
   extend `mapTask` to also search `subtasks` arrays.

2. **Stale "now" in a long-open tab.** `nowMs` is frozen at the last server render and only
   updates on a focus-triggered `router.refresh()`. A desktop tab left open overnight keeps
   showing yesterday's "Today" bucket, date label, and routine tick states. Fix: in
   `store.tsx`, keep a client-side `nowMs` state re-set every minute (or on a midnight-rollover
   timer) and feed it to `deriveEntities`/`deriveCalendarView`; `derive.ts` is already pure so
   this is cheap.

3. **Double refresh on focus.** `store.tsx` registers the same handler for both
   `visibilitychange` and `focus`; returning to the tab fires both → two full `router.refresh()`
   round trips. Fix: debounce (e.g. skip if a refresh ran in the last 5 s).

4. **Habit "days" are UTC epoch buckets, not calendar days.** `habitPeriodIndex` =
   `floor(epochMs / windowMs)`, so a daily habit's boundary is UTC midnight (08:00 in Perth):
   completing at 07:50 and 08:10 local counts as two days; 21:00 then 07:00 next morning counts
   as the same day. MONTH is hardcoded to 30 days. Fix: compute period index from the *zoned*
   calendar date (`zonedYMD` in `taskbookDates.ts`) — day count since epoch in the configured
   zone. Update all three copies: `api.ts` (`habitPeriodIndex`), `derive.ts`, and
   `store.tsx`'s `markHabitDone` optimistic patch. Migrate nothing — streak values carry over.

5. **Work/Home mode filter is hardcoded to two category names.** `derive.ts`
   `taskMatchesMode` matches `category.toLowerCase() === mode` — a task in any other category
   (categories are user-editable free text) is invisible in both Work and Home modes. Fix:
   add a `scope` field (`WORK | HOME | NONE`) on `Category` (schema change, follow field
   chain) or at minimum surface "uncategorised for this mode" tasks in both modes.

6. **iOS `h-screen` viewport bug.** `layout.tsx` uses `h-screen` (100vh); on iOS Safari /
   installed PWA the bottom tab bar can sit under the browser chrome / home indicator. Fix:
   `h-dvh` + `pb-[env(safe-area-inset-bottom)]` on `BottomTabs`.

7. **Silent write failures / no undo.** A failed background mutation just logs and refreshes —
   the user's edit vanishes with no explanation. Deletes are instant and irreversible. Fix: a
   small toast system in the store (`send()` catch → toast "Couldn't save X — restored"), and
   an undo snackbar for deletes (keep the removed row in memory 6 s; undo = re-create).

8. **MCP secret is in the URL path** (`/api/mcp/[secret]`). URLs leak into server/proxy logs.
   Low urgency (single user), but move to an `Authorization` header when convenient.

### 1B. Performance / efficiency

1. **Full SSR refresh on every focus.** Each tab-return re-runs 5 entity queries + settings
   upsert + captures + dismissed-events sweep + calendar cache read. On mobile this is every
   app switch. Mitigations, in order of value: (a) the debounce from 1A-3; (b) stop doing
   *writes* on the read path — `getAppSettings` upsert, `getCategories` seed, and especially
   `getDismissedCalendarEventIds`'s `deleteMany` sweep should move to the cron route;
   (c) longer-term, replace focus-refresh with a light `GET /api/state?since=` JSON endpoint.

2. **Unbounded growth.** Completed tasks are fetched forever (`getTasks` has no filter), and
   every keystroke/mutation re-derives over all of them. Add archiving: default fetch excludes
   tasks completed more than 30 days ago; add a "Logbook" view (see Part 4) that pages through
   the archive on demand.

3. **All five mobile carousel panels render permanently**, and the search `query` lives in
   `TaskbookApp` state so every keystroke re-renders every view. Fix: `React.memo` the view
   components and row components; consider moving `query` into a context read only by rows,
   or debouncing it.

4. **Duplicated logic drift risk** between `api.ts`, `derive.ts`, and `store.tsx` (habit
   streak math exists in three places, `combineDueDateTime` in two, `NO_REPEAT` in two).
   Extract a client-safe `src/lib/shared.ts` that `api.ts` also imports (pure functions only,
   no `server-only`), so there is exactly one copy.

### 1C. Design / layout

1. **No theming layer.** Hex colors (`#efe9dc`, `#17399b`, `#8a8069`…) are hardcoded in every
   component (~40 files' worth of literals). Extract to CSS variables in `globals.css`
   (`--surface`, `--ink`, `--accent`, `--muted`, `--danger`…) and reference via Tailwind
   arbitrary values (`bg-(--surface)`). This is the prerequisite for dark mode and makes any
   future restyle a one-file change.
2. **No dark mode.** After tokenisation: `@media (prefers-color-scheme: dark)` overrides of the
   variables, plus `theme_color` handling in `manifest.ts`.
3. **Accessibility gaps.** Icon-only buttons (mic, add, mode toggle, delete) need
   `aria-label`s; several controls are `text-xs` with sub-40px hit targets on mobile; at-risk
   habits are signalled by colour alone (add an icon/text). Run through once.
4. **No keyboard support on desktop.** At minimum: `n` = new task, `/` = focus search,
   `Esc` closes modals (verify), arrow/j-k row focus is a stretch goal.

---

## Part 2 — Notification system rebuild (Phase 1, highest priority)

### Why the current system fails

- **Delivery layer:** Web Push to browser vendors is best-effort. On iOS it only works from an
  installed PWA, and — critically — the current "silent push then close-by-tag" auto-dismiss
  trick (`notifications.ts` + `sw.js`) sends pushes that show no user-visible notification.
  iOS treats repeated non-user-visible pushes as abuse and **silently revokes the push
  subscription**, after which *nothing* arrives until the user re-enables. This is the most
  likely cause of "notifications just stop working" on the phone. On laptop, Chrome must be
  running to receive push at all, and macOS focus modes eat the rest.
- **Scheduling layer:** everything depends on an external scheduler hitting
  `/api/cron/check-due` every minute. There is no heartbeat, so when it lapses the failure is
  invisible.

### New design: dedicated push service + auto-tick routines

**Switch delivery to a native push app.** Two good options; both have real iOS/Android/desktop
apps with reliable APNs/FCM delivery and a **persistent notification history** (which directly
satisfies "the notification persists" even after auto-ticking):

| | ntfy.sh | Pushover |
|---|---|---|
| Cost | Free (hosted) | US$5 one-time per platform |
| iOS/Android apps | Yes | Yes |
| Desktop | Web app + macOS menu-bar clients | Native macOS app |
| Action buttons in notification | **Yes** (HTTP action → can hit an app endpoint) | No (ack only on emergency priority) |
| History/persistence | Yes, per-topic log | Yes, in-app history |
| Reliability on iOS | Very good (via their APNs bridge) | Excellent |

**Recommendation: ntfy** (free, and its action buttons enable "Snooze" / "Un-tick" buttons on
the notification itself). Pushover is the drop-in fallback if ntfy delivery ever disappoints.

**Implementation steps:**

1. `src/lib/notifications.ts`: extract `sendToAllSubscriptions` behind a
   `deliver(payload: PushPayload)` function. Add an ntfy provider: `POST
   https://ntfy.sh/<NTFY_TOPIC>` with headers `Title`, `Tags`, `Priority`, `Click` (deep link
   to the app), and optional `Actions` (e.g. `http, Snooze 30m, <app-url>/api/notify-action…`).
   Env: `NTFY_TOPIC` (treat the topic as a secret — random 32-char string), optional
   `NTFY_TOKEN` for a reserved topic. Keep the Web Push path as a secondary provider behind a
   flag for now; delete it once ntfy is proven.
2. **Routines auto-tick on notify.** In `checkAndNotifyDueRoutines`: after sending a cluster's
   notification, call the existing `completeRoutineCluster(r.id)` logic (set
   `lastCompletedAt = notifiedAt = now` on parent + children) instead of only
   `markRoutineNotified`. **Delete the entire auto-close machinery**: `toClose`,
   `CLOSE_CHECK_WINDOW_MS`, the `close: true` payload variant, and the corresponding branch in
   `public/sw.js`. The notification persists in ntfy's history; the routine shows ticked in the
   app. Add an "Undo tick" affordance in `RoutinesView` (already effectively exists — ticks
   expire after 1 h — but add an explicit un-tick so an auto-ticked routine the user *didn't*
   do can be reinstated; ntfy action button "Not done" can hit `/api/notify-action` to un-tick
   remotely).
3. **Lead-time reminders for tasks/projects.** New field `reminderLeadMinutes Int?` on Task and
   Project (follow the field chain). Cron check becomes `dueInstant - lead <= now`. UI: small
   "remind me: at time / 10m / 30m / 1h / 1d before" select next to the due-time picker.
4. **Scheduler + heartbeat.** Use cron-job.org (free, true per-minute, retry + failure
   emails) or GitHub Actions `schedule` as the caller. In `/api/cron/check-due`, stamp
   `AppSettings.lastCronAt = now` on every run (add the column). In `Header.tsx`/settings,
   show a warning banner when `now - lastCronAt > 10 min` — the silent-failure mode becomes
   visible. Optionally also ping healthchecks.io from the cron route.
5. **Test button.** In `SettingsModal`: "Send test notification" → new authenticated route
   `/api/push/test` → `deliver({title: "Test", …})`. Removes all guesswork when debugging a
   device.

---

## Part 3 — Offline mode (Phase 2)

The architecture is already 80% local-first: `derive.ts` is pure and client-safe, and the store
applies every mutation optimistically. What's missing is (a) an app shell that loads with no
network, (b) a persisted data snapshot, (c) a durable outbox for mutations, (d) a battery-sane
reconnect policy.

1. **App shell caching.** Adopt **Serwist** (`@serwist/next` — the maintained Workbox successor
   for Next.js App Router). Move the push/notificationclick handlers from `public/sw.js` into
   the Serwist worker source so there's one SW. Strategy: precache build assets;
   `NetworkFirst` (3 s timeout) for navigations with the cached shell as fallback;
   `StaleWhileRevalidate` for fonts/icons. Note the repo's Next version is newer than training
   data — check `client/node_modules/next/dist/docs/` and Serwist's Next 16 guidance before
   wiring the plugin.
2. **Snapshot persistence.** In `StoreProvider`, write `raw` (plus `calendarEvents` and
   `nowMs`) to IndexedDB via `idb-keyval` on every `setRaw` (debounced ~500 ms, key
   `cura-snapshot-v1`). On mount, if the SW served the cached shell (server data missing/stale)
   or `navigator.onLine === false`, hydrate from the snapshot. Dates round-trip as strings —
   `derive.ts` already `new Date()`s every date field it touches, so no schema work needed,
   but verify each field.
3. **Durable outbox.** Replace the store's fire-and-forget `send(run)` with an outbox:
   - Each mutation appends `{seq, actionName, serializedArgs, tempIds}` to an IndexedDB queue
     *and* optimistically patches state (unchanged).
   - A single flusher drains the queue **in order** (creates before dependent updates — order
     is already implicit in append order). On a create resolving, record `tmp-id → real-id`
     and rewrite any queued ops referencing the tmp id (temp ids only appear in `id`/`parentId`
     /`projectId` args).
   - Distinguish failure types: network error (`TypeError: fetch failed` / `!navigator.onLine`)
     → leave in queue, schedule retry; server error (action threw) → drop the op, toast, and
     `router.refresh()` to reconcile (current behaviour).
   - After a full drain, one `router.refresh()` reconciles everything.
4. **Reconnect policy — no polling.** Do **not** run a periodic connectivity timer. Flush
   triggers: (a) `window 'online'` event; (b) `visibilitychange → visible`; (c) exponential
   backoff after a failed flush — 30 s, 2 min, 5 min, capped at 15 min, `setTimeout` only
   while the page is open; (d) register the **Background Sync API** (`sync` event in the SW)
   where supported (Chrome desktop/Android) so a closed tab still flushes. iOS has no
   Background Sync — the queue simply drains on next open, which is fine for a single user.
   This is event-driven, so there is zero battery cost while offline and idle.
5. **Graceful degradation + UI.** When offline: hide mic and AI chat (both need the network),
   show calendar from the snapshot, and render a slim banner: "Offline — N changes will sync
   when you reconnect" (N = queue length, exposed from the store). Small clock icon on rows
   created while offline (id starts with `tmp-`) is optional polish.
6. **Out of scope for v1:** conflict resolution beyond last-write-wins (single user, two
   devices rarely both offline-editing), offline voice capture, offline ICS refresh.

---

## Part 4 — Feature gaps vs. best-in-class (Todoist / Things 3 / TickTick) — Phase 3

Ordered by value-for-effort for a single-user app. Each follows the field-chain recipe.

1. **Natural-language quick add** (Todoist's killer feature). A single input parsed into
   title/date/time/repeat/category/project: "pay rent tomorrow 5pm every month #home".
   Implement as a pure client parser in `src/lib/quickAdd.ts` (chrono-node or hand-rolled for
   the app's known patterns) feeding the existing `actions.addTask`; no server changes. Add as
   the default field at the top of `TasksView` and as the desktop `n` shortcut.
2. **Priority on tasks** (`priority Int @default(4)`, Todoist-style P1–P4). Sort within due
   buckets by priority then time; red/orange/blue flag glyph on the row; quick-add tokens
   `!p1`–`!p3`.
3. **Logbook + recurring history.** New `CompletionLog` table `{id, entityType, entityId,
   title, completedAt}`. Write a row on: task completion, repeating-task roll-forward
   (currently leaves *no trace* — this is why there's no "did I do it last Tuesday?" answer),
   routine tick (incl. auto-tick, flagged `auto: true`), habit completion. Powers: a Logbook
   view (Things' feature), per-habit history grid (TickTick-style month dots — replaces
   streak-only display), and simple weekly stats ("completed this week: 23").
4. **Undo everywhere** (from 1A-7): deletion snackbar first, then completion undo.
5. **Snooze / "remind me again".** ntfy action button + in-app control that bumps a task's
   `dueDate`/reminder by 30 m / 1 h / tomorrow. Pairs with Part 2.
6. **Sections within projects** (Things' headings): `section String?` on Task, grouped render
   in the project card; drag-reorder can come later or never (single user, low churn).
7. **Manual ordering** (`sortOrder Float`) within buckets/projects — only if reordering pain is
   real; fractional-index on drop, no extra round trips through the optimistic store.
8. **Project templates** ("start of term" checklist): serialize a project + tasks to JSON,
   "New from template" in the Add modal. Cheap and very useful for a teacher's recurring
   setups.
9. **Weekly review mode** (GTD): a guided modal — overdue triage → no-date triage → upcoming
   week preview → habit check. Pure client composition of existing derived data; no schema.
10. **Text capture to task via share/Shortcut**: the voice-capture route already accepts
    `X-Shortcut-Secret`; add a `text` field fallback (skip Whisper, straight to the classifier)
    so an iOS share-sheet Shortcut can send highlighted text.

Explicitly **not** recommended: collaboration/assignees, comments, attachments, location
reminders, karma/gamification — they don't pay rent in a single-user app.

---

## Suggested execution order

| Phase | Scope | Items |
|---|---|---|
| 0 | Bug fixes, ~1 session | 1A-1…7, 1B-1(a,b) |
| 1 | Notifications | Part 2 complete (ntfy, auto-tick routines, lead times, heartbeat, test button) |
| 2 | Offline | Part 3 complete (Serwist shell, snapshot, outbox, event-driven sync) |
| 3 | Features | Part 4 in listed order; theming/dark mode (1C-1,2) can slot anywhere |

Verification notes for each phase: `npx tsc --noEmit` after every change set; there is no test
runner. Phase 1 must be verified end-to-end on the actual iPhone (installed PWA removed, ntfy
app installed, cron heartbeat visible). Phase 2 must be verified with DevTools offline mode:
create/edit/complete while offline → reload (shell + snapshot) → reconnect → confirm queue
drains and server state matches. Remember `db push` hits the live shared database — schema
changes go straight to production.
