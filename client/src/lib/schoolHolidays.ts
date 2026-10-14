// School holidays from the YCIS Shanghai Pudong calendar (2026-27, updated 5 June 2026), shown as
// an automatic "next holiday" row in the calendar rail's Countdowns block. Teacher in-service and
// learning-conference days aren't listed — staff still work them. Add the next year's dates here
// when the new calendar comes out. Client-safe; dates are inclusive yyyy-mm-dd calendar days.
export type SchoolHoliday = { title: string; start: string; end?: string }; // no end = not yet known

export const SCHOOL_HOLIDAYS: SchoolHoliday[] = [
  { title: "Mid-Autumn Festival", start: "2026-09-25", end: "2026-09-25" },
  { title: "National Day Holiday", start: "2026-10-01", end: "2026-10-06" },
  { title: "Christmas and New Year Holiday", start: "2026-12-19", end: "2027-01-03" },
  { title: "Chinese New Year Holiday", start: "2027-02-04", end: "2027-02-14" },
  { title: "Qing Ming and April Holiday", start: "2027-04-03", end: "2027-04-11" },
  { title: "Labour Day Holiday", start: "2027-05-01", end: "2027-05-03" },
  { title: "Dragon Boat Festival", start: "2027-06-09", end: "2027-06-09" },
  // Students finish 17 Jun; the 18th is a teacher in-service day.
  { title: "Summer Holiday", start: "2027-06-19" },
];
