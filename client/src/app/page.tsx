import { getHabits, getProjects, getRoutines, getTasks } from "@/lib/api";
import { getCalendarEvents } from "@/lib/calendar";
import {
  addHabit,
  addProject,
  addRoutine,
  addTask,
  markHabitDone,
  removeHabit,
  removeProject,
  removeRoutine,
  removeTask,
  toggleRoutine,
  toggleTask,
} from "@/app/actions";

const HABIT_FREQUENCY_LABELS: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
};

const inputClass =
  "min-w-0 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-transparent";
const buttonClass =
  "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black";

export default async function Home() {
  let tasks, habits, projects, routines;
  let apiError: string | null = null;

  try {
    [tasks, habits, projects, routines] = await Promise.all([
      getTasks(),
      getHabits(),
      getProjects(),
      getRoutines(),
    ]);
  } catch {
    apiError = "Could not reach the database. Check DATABASE_URL in .env.local.";
  }

  if (apiError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-zinc-600 dark:text-zinc-400">{apiError}</p>
      </div>
    );
  }

  // Kept separate from the Promise.all above: a missing/misconfigured calendar
  // shouldn't take down the rest of the dashboard.
  let calendarEvents: Awaited<ReturnType<typeof getCalendarEvents>>["events"] = [];
  let calendarErrors: string[] = [];
  try {
    ({ events: calendarEvents, errors: calendarErrors } = await getCalendarEvents());
  } catch {
    calendarErrors = ["Could not load the calendar."];
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl mx-auto flex-col gap-10 py-16 px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Life OS
        </h1>

        <Section title="Calendar">
          {calendarErrors.map((error) => (
            <p key={error} className="text-sm text-zinc-400">
              {error}
            </p>
          ))}
          {calendarEvents.length === 0 && calendarErrors.length === 0 && <Empty />}
          {calendarEvents.length > 0 && (
            <ul className="flex flex-col gap-2">
              {calendarEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div className="flex flex-col">
                    <span className="text-zinc-900 dark:text-zinc-50">{event.title}</span>
                    <span className="text-xs text-zinc-400">
                      {event.source}
                      {event.location && ` · ${event.location}`}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-400">{formatEventTime(event)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Tasks">
          <form action={addTask} className="flex flex-wrap gap-2">
            <input
              name="title"
              placeholder="Title"
              required
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            />
            <input
              name="category"
              placeholder="Category"
              required
              className="w-32 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            />
            <input
              name="dueDate"
              type="date"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
            >
              Add
            </button>
          </form>

          {tasks!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {tasks!.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <form action={toggleTask.bind(null, task.id, task.isCompleted)}>
                  <button
                    type="submit"
                    className={
                      task.isCompleted
                        ? "line-through text-zinc-400"
                        : "text-left text-zinc-900 dark:text-zinc-50"
                    }
                  >
                    {task.title}
                  </button>
                </form>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-wide text-zinc-400">
                    {task.category}
                  </span>
                  <form action={removeTask.bind(null, task.id)}>
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 hover:text-red-500"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Habits">
          <form action={addHabit} className="flex flex-wrap gap-2">
            <input name="title" placeholder="Title" required className={inputClass + " flex-1"} />
            <select name="frequency" defaultValue="DAILY" className={inputClass}>
              {Object.entries(HABIT_FREQUENCY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button type="submit" className={buttonClass}>
              Add
            </button>
          </form>

          {habits!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {habits!.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div className="flex flex-col">
                  <span className="text-zinc-900 dark:text-zinc-50">{habit.title}</span>
                  <span className="text-xs text-zinc-400">
                    {HABIT_FREQUENCY_LABELS[habit.frequency]} · streak {habit.currentStreak}
                    {habit.longestStreak > habit.currentStreak && ` (best ${habit.longestStreak})`}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <form action={markHabitDone.bind(null, habit.id)}>
                    <button type="submit" className={buttonClass}>
                      Done
                    </button>
                  </form>
                  <DeleteButton action={removeHabit.bind(null, habit.id)} />
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Projects">
          <form action={addProject} className="flex flex-wrap gap-2">
            <input name="name" placeholder="Name" required className={inputClass + " flex-1"} />
            <input name="description" placeholder="Description" className={inputClass + " flex-1"} />
            <button type="submit" className={buttonClass}>
              Add
            </button>
          </form>

          {projects!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {projects!.map((project) => (
              <li
                key={project.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
              >
                {project.name}
                <DeleteButton action={removeProject.bind(null, project.id)} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Routines">
          <form action={addRoutine} className="flex flex-wrap gap-2">
            <input name="title" placeholder="Title" required className={inputClass + " flex-1"} />
            <input name="reminderTime" placeholder="08:00" required className={inputClass + " w-24"} />
            <button type="submit" className={buttonClass}>
              Add
            </button>
          </form>

          {routines!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {routines!.map((routine) => (
              <li
                key={routine.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <form action={toggleRoutine.bind(null, routine.id, routine.isActive)}>
                  <button
                    type="submit"
                    className={
                      routine.isActive
                        ? "text-left text-zinc-900 dark:text-zinc-50"
                        : "text-left text-zinc-400 line-through"
                    }
                  >
                    {routine.title}
                  </button>
                </form>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-400">{routine.reminderTime}</span>
                  <DeleteButton action={removeRoutine.bind(null, routine.id)} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-zinc-400">Nothing here yet.</p>;
}

function formatEventTime(event: { start: string; allDay: boolean }) {
  const start = new Date(event.start);
  if (event.allDay) {
    return start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  return start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DeleteButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <button type="submit" className="text-xs text-zinc-400 hover:text-red-500">
        Delete
      </button>
    </form>
  );
}
