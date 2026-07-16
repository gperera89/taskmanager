# Cura — Stream Deck profile

Key images (288×288 PNG, Cura paper theme) for a 15-key Stream Deck Mobile page.
Each key is a **System → Hotkey** action sending a single plain keypress — the app
listens for these in `TaskbookApp.tsx` (shortcuts are ignored while typing in any
field, so they never interfere with text entry). The browser tab with Cura must be
the focused app for the keys to land.

## Layout (5 × 3)

| Row | Keys |
|-----|------|
| 1 — Views | `1-tasks` · `2-projects` · `3-routines` · `4-habits` · `5-calendar` |
| 2 — Actions | `d-my-day` · `n-new` · `slash-search` · `l-logbook` · `r-review` |
| 3 — Modes & windows | `h-home-mode` · `a-all-mode` · `w-work-mode` · `s-settings` · `esc-close` |

## Hotkey assignments

| Image | Hotkey | Action in Cura |
|-------|--------|----------------|
| 1-tasks.png | `1` | Tasks view |
| 2-projects.png | `2` | Projects view |
| 3-routines.png | `3` | Routines view |
| 4-habits.png | `4` | Habits view |
| 5-calendar.png | `5` | Calendar view (mobile layout only — no-op on desktop, where the calendar is the side rail) |
| d-my-day.png | `D` | My Day — today's timeline |
| n-new.png | `N` | New item (Add form matching the active view) |
| slash-search.png | `/` | Focus the search box |
| s-settings.png | `S` | Settings |
| l-logbook.png | `L` | Logbook (completion history) |
| r-review.png | `R` | Weekly review |
| h-home-mode.png | `H` | Home mode |
| a-all-mode.png | `A` | All mode |
| w-work-mode.png | `W` | Work mode |
| esc-close.png | `Esc` | Close any open modal |

## Setup (Stream Deck Mobile)

1. In the Stream Deck app, create a new profile named **Cura**.
2. For each key: drag **System → Hotkey** onto the slot, set the hotkey from the
   table above (no modifiers — plain keypress), and set the key's icon to the
   matching PNG from this folder.
3. Regenerate the images after a palette change with `node generate.mjs` from this
   folder (they're plain SVG-to-PNG renders of the app's own Material Symbols
   glyphs and `globals.css` colours, rasterised with `client/`'s sharp).
