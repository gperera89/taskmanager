// One-off import of TickTick tasks/routines/habits into Cura (2026-07-12).
// Safe to re-run: skips any task/routine/habit/project whose title already exists.
// Aborts if the connected database doesn't look like the (near-empty) production DB.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const matches = [...env.matchAll(/^DATABASE_URL=(.+)$/gm)].map((m) => m[1].trim().replace(/^"|"$/g, ""));
const connectionString = matches.find((u) => !u.includes("pooled.")) ?? matches[0];
if (!connectionString) throw new Error("No DATABASE_URL found in .env.local");
console.log("Connecting to:", connectionString.replace(/\/\/[^@]*@/, "//***@"));

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// --- Safety: make sure this is the new (near-empty) production DB, not the old one ---
const taskCount = await prisma.task.count();
const routineCount = await prisma.routine.count();
if (taskCount > 10 || routineCount > 0) {
  console.error(`ABORT: found ${taskCount} tasks / ${routineCount} routines — this looks like the OLD database. Not writing anything.`);
  process.exit(1);
}

// Due dates are stored as UTC midnight of the calendar date with the clock time layered on
// at face value (mirrors api.ts combineDueDateTime).
const due = (date, time) => (date ? new Date(`${date}T${time || "00:00"}:00.000Z`) : null);

const NO_REPEAT = {
  repeatFrequency: null, repeatInterval: null, repeatDaysOfWeek: [],
  repeatMonthlyMode: null, repeatDayOfMonth: null, repeatMonthlyOrdinal: null, repeatMonthlyWeekday: null,
};
const weekly = (days, interval = 1) => ({
  ...NO_REPEAT, repeatFrequency: "WEEKLY", repeatInterval: interval, repeatDaysOfWeek: days,
});
const monthlyDate = (dayOfMonth, interval = 1) => ({
  ...NO_REPEAT, repeatFrequency: "MONTHLY", repeatInterval: interval, repeatMonthlyMode: "DATE", repeatDayOfMonth: dayOfMonth,
});
const monthlyWeekday = (ordinal, weekday, interval = 1) => ({
  ...NO_REPEAT, repeatFrequency: "MONTHLY", repeatInterval: interval, repeatMonthlyMode: "WEEKDAY",
  repeatMonthlyOrdinal: ordinal, repeatMonthlyWeekday: weekday,
});

// --- Tasks (times already converted to Asia/Shanghai wall clock) ---
const TASKS = [
  // Work
  { title: "Do CENTURY Ranking", category: "Work", date: "2026-09-07", repeat: weekly([1], 2) },
  { title: "Update New Admissions Orientation PowerPoint", category: "Work", date: "2026-08-26" },
  { title: "Mark CENTURY on ManageBac", category: "Work", date: "2026-08-24", repeat: weekly([1]) },
  { title: "Set Century on ManageBac", category: "Work", date: "2026-08-17", repeat: weekly([1]) },
  { title: "Give out a merit", category: "Work", date: "2026-08-14", repeat: weekly([5]) },
  { title: "Organise Work Tasks on Calendar", category: "Work", date: "2026-08-12", time: "07:30", repeat: weekly([1, 2, 3, 4, 5]) },
  { title: "Ask Vicky to incorporate the Student Contract for Overnight Trips", category: "Work", date: "2026-08-03" },
  { title: "Update ManageBac Guidance Document", category: "Work", date: "2026-08-01", description: "Remove YCIS CARES\nReplace Learner Profile with Portrait" },
  { title: "Watch the CEM Set Up Videos", category: "Work", date: "2026-07-30", description: "https://help.cem.org/hc/en-gb/articles/21706756463378-MidYIS-and-Yellis" },
  { title: "Update ManageBac Planner Documentation", category: "Work", date: "2026-07-30" },
  // Home
  { title: "Make Dentist Appointment", category: "Home", date: "2027-02-01", description: "Most recent was on July 4 2026." },
  { title: "Replace Gasket on Coffee Machine", category: "Home", date: "2026-10-24", time: "09:00", repeat: monthlyWeekday(4, 6, 4) },
  { title: "Update Quarterly Net Worth", category: "Home", date: "2026-09-30", repeat: monthlyDate(-1, 3) },
  { title: "Deep Clean Coffee Grinder", category: "Home", date: "2026-08-02", repeat: monthlyWeekday(1, 0, 3) },
  { title: "Clean washing machine", category: "Home", date: "2026-08-01", time: "08:00", repeat: monthlyWeekday(1, 6, 1) },
  { title: "Pay Phone Bill", category: "Home", date: "2026-08-01", repeat: monthlyDate(1) },
  { title: "Pay 28 Degrees MasterCard", category: "Home", date: "2026-08-01", repeat: monthlyDate(1) },
  { title: "Move Money to Schwab", category: "Home", date: "2026-07-31", repeat: monthlyDate(-1) },
  { title: "Buy Stocks", category: "Home", date: "2026-07-31", repeat: monthlyDate(31) },
  { title: "Pay Rent", category: "Home", date: "2026-07-31", repeat: monthlyDate(31) },
  { title: "Complete Tax Return", category: "Home", date: "2026-07-31", repeat: monthlyWeekday(-1, 6, 12) },
  { title: "Trim Nails", category: "Home", date: "2026-07-25", time: "19:00", repeat: weekly([6], 2) },
  { title: "Put Dry Dishes Away", category: "Home", date: "2026-07-18", time: "07:00", repeat: weekly([0, 6]) },
  { title: "Pay Ayi", category: "Home", date: "2026-07-10", time: "17:00", repeat: weekly([5]) },
  // Inbox captures
  { title: "Rethink the routine idea - it's a good thought, for some routines, but others need a persisting reminder for others if they're going to work", category: "Home", date: "2026-07-10" },
  { title: "Idea to add a reading text, video, journal article or something on each science topic, along with a MS forms or some other digital assessment to be completed to check understanding- with some long answer questions too. Something that can be done in 10 mins to improve reading", category: "Home", date: "2026-07-10" },
  { title: "Enable some kind of offline mode that would allow it to function", category: "Home", date: "2026-07-09" },
  { title: "Look into straps", category: "Home" },
];

// Media watch-list lives in its own project.
const MEDIA_TASKS = [
  "Puppy Love (2023)",
  "Noam Chomsky",
  "Those About to Die",
  "Wild Wild Space (Film)",
  "Industry (TV Series)",
  "The Forgiven (Ralph Fiennes & Jessica Chastain)",
];

// --- Routines (reminder times in Asia/Shanghai wall clock; days: 0=Sun..6=Sat) ---
const WEEKDAYS = [1, 2, 3, 4, 5];
const ROUTINES = [
  { title: "Workday Morning Routine", time: "05:05", frequency: "WEEKLY", days: WEEKDAYS,
    subs: ["Make the Bed", "Put Dry Dishes Away", "Put in contacts", "Brush Teeth", "Make Coffee", "Drink 500mL of water"] },
  { title: "Bring new shirts to work", time: "05:05", frequency: "WEEKLY", days: [1, 3], subs: [] },
  { title: "Wash bedsheets", time: "05:05", frequency: "WEEKLY", days: [2], subs: [] },
  { title: "Pre-Workout Routine", time: "06:00", frequency: "WEEKLY", days: WEEKDAYS,
    subs: ["Put wedding ring on desk", "Pack towel", "Pack formal shoes", "Pack underwear, singlet and socks",
      "Put dirty clothes bag in duffle", "Put in AirPods Pro", "Pack trousers, shirt and belt", "Put water bottle into duffle"] },
  { title: "Post-Workout Routine", time: "07:28", frequency: "WEEKLY", days: WEEKDAYS,
    subs: ["Put AirPods Pro in backpack", "Make Coffee", "Hang up the towel"] },
  { title: "Water Plants", time: "07:30", frequency: "WEEKLY", days: [1], subs: [] },
  { title: "Bring Towel Home", time: "15:50", frequency: "WEEKLY", days: [5], subs: [] },
  { title: "Home Routine after work", time: "17:30", frequency: "WEEKLY", days: WEEKDAYS,
    subs: ["Pack clothes to change into after work", "Put gym clothes into the washing basket"] },
  { title: "Make breakfast for the week", time: "17:00", frequency: "WEEKLY", days: [0], subs: [] },
  { title: "Routine before work", time: "20:00", frequency: "WEEKLY", days: [0],
    subs: ["Pack new underwear, socks and singlets", "Pack fresh towel", "Refill pill box with medicine and supplements", "Pack new shirts into suit protectors"] },
  { title: "Evening Routine", time: "20:20", frequency: "DAILY", days: [],
    subs: ["Take out contact lenses", "Shave", "Face care"] },
];

const HABITS = [{ title: "Fluid cutoff — no drinks after 7pm", intervalValue: 1, intervalUnit: "DAY" }];

// --- Run ---
const summary = { projects: 0, tasks: 0, routines: 0, subroutines: 0, habits: 0, skipped: 0 };

// Media project
let media = await prisma.project.findFirst({ where: { name: "Media" } });
if (!media) {
  media = await prisma.project.create({ data: { name: "Media", description: "Watch list (imported from TickTick)" } });
  summary.projects++;
}

const existingTitles = new Set((await prisma.task.findMany({ select: { title: true } })).map((t) => t.title));

for (const t of TASKS) {
  if (existingTitles.has(t.title)) { summary.skipped++; continue; }
  await prisma.task.create({
    data: {
      title: t.title, category: t.category, description: t.description ?? null,
      dueDate: due(t.date, t.time), ...(t.repeat ?? NO_REPEAT),
    },
  });
  summary.tasks++;
}

for (const title of MEDIA_TASKS) {
  if (existingTitles.has(title)) { summary.skipped++; continue; }
  await prisma.task.create({ data: { title, category: "Home", projectId: media.id } });
  summary.tasks++;
}

const existingRoutines = new Set((await prisma.routine.findMany({ select: { title: true } })).map((r) => r.title));
for (const r of ROUTINES) {
  if (existingRoutines.has(r.title)) { summary.skipped++; continue; }
  const schedule = { frequency: r.frequency, interval: 1, daysOfWeek: r.days, monthlyMode: "DATE" };
  const parent = await prisma.routine.create({ data: { title: r.title, reminderTime: r.time, ...schedule } });
  summary.routines++;
  for (const sub of r.subs) {
    await prisma.routine.create({ data: { title: sub, reminderTime: r.time, ...schedule, parentId: parent.id } });
    summary.subroutines++;
  }
}

const existingHabits = new Set((await prisma.habit.findMany({ select: { title: true } })).map((h) => h.title));
for (const h of HABITS) {
  if (existingHabits.has(h.title)) { summary.skipped++; continue; }
  await prisma.habit.create({ data: h });
  summary.habits++;
}

console.log("Import complete:", summary);
await prisma.$disconnect();
