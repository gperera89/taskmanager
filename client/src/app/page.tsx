import { getHabits, getProjects, getRoutines, getTasks } from "@/lib/api";

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
    apiError = "Could not reach the API. Is the Express server running (npm start in /server)?";
  }

  if (apiError) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
        <p className="text-zinc-600 dark:text-zinc-400">{apiError}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl mx-auto flex-col gap-10 py-16 px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Life OS
        </h1>

        <Section title="Tasks">
          {tasks!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {tasks!.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <span
                  className={
                    task.isCompleted
                      ? "line-through text-zinc-400"
                      : "text-zinc-900 dark:text-zinc-50"
                  }
                >
                  {task.title}
                </span>
                <span className="text-xs uppercase tracking-wide text-zinc-400">
                  {task.category}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Habits">
          {habits!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {habits!.map((habit) => (
              <li
                key={habit.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <span className="text-zinc-900 dark:text-zinc-50">{habit.title}</span>
                <span className="text-xs text-zinc-400">
                  streak {habit.currentStreak}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Projects">
          {projects!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {projects!.map((project) => (
              <li
                key={project.id}
                className="rounded-lg border border-zinc-200 px-4 py-3 text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
              >
                {project.name}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Routines">
          {routines!.length === 0 && <Empty />}
          <ul className="flex flex-col gap-2">
            {routines!.map((routine) => (
              <li
                key={routine.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <span className="text-zinc-900 dark:text-zinc-50">{routine.title}</span>
                <span className="text-xs text-zinc-400">{routine.reminderTime}</span>
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
