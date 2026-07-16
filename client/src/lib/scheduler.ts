// The My Day auto-scheduler: packs flexible (unpinned) items into the free gaps between fixed
// obstacles (events, pinned blocks, routines, template anchors), respecting the day template's
// zones. Pure and client-safe — it runs inside deriveMyDay on every store tick/edit, which is
// what makes the schedule *dynamic*: completing an item shrinks the pool and everything moves
// up; running past a slot re-packs the remainder from "now". Nothing here is persisted — pinned
// times and durations are the only stored state, so reflows cost zero writes.

import { scopeFitsZone, type DayZone } from "@/lib/dayTemplate";

export type Obstacle = { startMinutes: number; endMinutes: number };

export type FlexItem = {
  key: string;
  durationMinutes: number;
  scope: "work" | "home" | "both";
};

const GRANULARITY = 5;

function roundUp(minutes: number): number {
  return Math.ceil(minutes / GRANULARITY) * GRANULARITY;
}

function overlaps(obstacles: Obstacle[], start: number, end: number): boolean {
  return obstacles.some((o) => start < o.endMinutes && end > o.startMinutes);
}

// First free start ≥ `from` where `duration` fits before `until`, stepping past whichever
// obstacle blocked the attempt (rather than crawling in 5-minute increments through it).
function findSlot(obstacles: Obstacle[], from: number, until: number, duration: number): number | null {
  let start = roundUp(from);
  while (start + duration <= until) {
    const blocker = obstacles.find((o) => start < o.endMinutes && start + duration > o.startMinutes);
    if (!blocker) return start;
    start = roundUp(blocker.endMinutes);
  }
  return null;
}

// Lunch floats to the free slot in its window nearest the target time (noon). If the whole
// window is blocked by meetings it falls back to the target anyway — a visible overlap beats
// silently skipping lunch.
export function placeLunch(
  cfg: { windowStartMinutes: number; windowEndMinutes: number; targetMinutes: number; durationMinutes: number },
  obstacles: Obstacle[],
  earliest: number
): number {
  const from = Math.max(cfg.windowStartMinutes, roundUp(earliest));
  let best: number | null = null;
  for (let start = from; start + cfg.durationMinutes <= cfg.windowEndMinutes; start += GRANULARITY) {
    if (overlaps(obstacles, start, start + cfg.durationMinutes)) continue;
    if (best === null || Math.abs(start - cfg.targetMinutes) < Math.abs(best - cfg.targetMinutes)) best = start;
  }
  return best ?? Math.max(cfg.targetMinutes, from);
}

// Greedy pack: items in priority order each take the earliest free slot in the first
// scope-matching zone that fits them. Placed items become obstacles for the rest.
export function packFlexible(
  items: FlexItem[],
  zones: DayZone[],
  obstacles: Obstacle[],
  earliestMinutes: number
): { placed: Map<string, number>; overflow: Set<string> } {
  const placed = new Map<string, number>();
  const overflow = new Set<string>();
  const taken: Obstacle[] = [...obstacles];
  const orderedZones = [...zones].sort((a, b) => a.startMinutes - b.startMinutes);

  for (const item of items) {
    let start: number | null = null;
    for (const zone of orderedZones) {
      if (!scopeFitsZone(item.scope, zone)) continue;
      start = findSlot(taken, Math.max(zone.startMinutes, earliestMinutes), zone.endMinutes, item.durationMinutes);
      if (start != null) break;
    }
    if (start == null) {
      overflow.add(item.key);
    } else {
      placed.set(item.key, start);
      taken.push({ startMinutes: start, endMinutes: start + item.durationMinutes });
    }
  }
  return { placed, overflow };
}
