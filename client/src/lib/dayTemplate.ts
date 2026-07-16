// The wellbeing day template: how a day is zoned (fitness/getting-ready → work → home) and the
// fixed wellbeing anchors (morning snack, lunch + its order-ahead task). Client-safe constants —
// consumed by deriveMyDay/scheduler to zone the My Day timeline and place template blocks.
//
// v1 is a hardcoded default rather than a DB setting: single-user app, and the planned settings
// UI was read-only anyway. Move this into AppSettings (JSON column) when it needs to be editable
// in-app.

// Which item scopes an auto-scheduling zone accepts. Items derive their scope from their task
// category's CategoryScope ("both" = NONE = fits anywhere); routines/habits/projects have no
// category and also count as "both".
export type ZoneScope = "work" | "home" | "any";

export type DayZone = {
  key: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  scope: ZoneScope;
};

export type DayTemplate = {
  // Days treated as workdays (0=Sunday..6=Saturday).
  workdays: number[];
  workdayZones: DayZone[];
  offdayZones: DayZone[];
  // Lunch floats inside its window to the free slot nearest `targetMinutes`, dodging meetings;
  // the "Order lunch" companion lands `orderLeadMinutes` before wherever lunch settles.
  lunch: {
    windowStartMinutes: number;
    windowEndMinutes: number;
    targetMinutes: number;
    durationMinutes: number;
    orderLeadMinutes: number;
    orderDurationMinutes: number;
  };
  snack: { startMinutes: number; durationMinutes: number; label: string };
};

const H = (hours: number, minutes = 0) => hours * 60 + minutes;

export const DEFAULT_DAY_TEMPLATE: DayTemplate = {
  workdays: [1, 2, 3, 4, 5],
  workdayZones: [
    // Mornings are protected for health/fitness and getting ready — home/neutral items only.
    { key: "morning", label: "Health & fitness · Getting ready", startMinutes: H(5), endMinutes: H(7, 30), scope: "home" },
    { key: "work", label: "Work", startMinutes: H(7, 30), endMinutes: H(16, 30), scope: "work" },
    // Aim to be done by 4:30–5 — evenings take home items, never leftover work.
    { key: "home", label: "Home", startMinutes: H(16, 30), endMinutes: H(21), scope: "home" },
  ],
  offdayZones: [{ key: "day", label: "", startMinutes: H(5), endMinutes: H(21), scope: "any" }],
  lunch: {
    windowStartMinutes: H(11, 30),
    windowEndMinutes: H(13),
    targetMinutes: H(12),
    durationMinutes: 40,
    orderLeadMinutes: 40,
    orderDurationMinutes: 10,
  },
  snack: { startMinutes: H(10, 15), durationMinutes: 10, label: "Morning break snack" },
};

export function zonesForWeekday(template: DayTemplate, weekday: number): DayZone[] {
  return template.workdays.includes(weekday) ? template.workdayZones : template.offdayZones;
}

// Whether an item of `itemScope` may be auto-scheduled into `zone`.
export function scopeFitsZone(itemScope: "work" | "home" | "both", zone: DayZone): boolean {
  if (zone.scope === "any" || itemScope === "both") return true;
  return itemScope === zone.scope;
}
