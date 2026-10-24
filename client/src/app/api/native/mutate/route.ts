import {
  createTask, updateTask, toggleTaskCompletion, deleteTask, snoozeTask, reorderTasks,
  createProject, updateProject, deleteProject, setProjectSections, duplicateProject,
  createRoutine, updateRoutine, completeRoutineCluster, untickRoutineCluster, deleteRoutine, createSubroutine,
  createHabit, updateHabit, completeHabit, toggleHabitCompletion, deleteHabit,
  createNote, updateNote, saveNoteBody, deleteNote,
  createCountdown, updateCountdown, deleteCountdown,
  createCategory, updateCategory, updateCategoryScope, deleteCategory,
  type TaskRepeatInput,
} from "@/lib/api";
import type { CategoryScope, HabitScheduleType, RoutineFrequency, RoutineMonthlyMode } from "@prisma/client";
import { nativeAuth } from "../auth";

// Mutation gateway for the native Mac client: one endpoint, an `action` discriminator, and a
// JSON body mapped straight onto lib/api.ts's functions — the same functions the web app's
// server actions call, so every business rule (date encoding, repeat roll-forward, note
// checkbox sync, completion logging) is enforced server-side in exactly one place.

type Json = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(message);
}

function requiredString(body: Json, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) fail(`"${key}" is required`);
  return v as string;
}

function id(body: Json): string {
  return requiredString(body, "id");
}

// Copies only the keys actually present in the JSON body into a typed patch, preserving the
// absent-key = "leave as-is" / explicit-null = "clear" semantics that lib/api.ts relies on.
function pick<T extends object>(body: Json, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out as Partial<T>;
}

function repeatInput(v: unknown): TaskRepeatInput | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v as TaskRepeatInput;
}

async function dispatch(action: string, body: Json): Promise<unknown> {
  switch (action) {
    // --- Tasks ---
    case "task.create":
      return createTask({
        title: requiredString(body, "title"),
        category: requiredString(body, "category"),
        description: (body.description as string | null | undefined) ?? undefined,
        dueDate: (body.dueDate as string | null | undefined) ?? undefined,
        dueTime: (body.dueTime as string | null | undefined) ?? undefined,
        projectId: (body.projectId as string | null | undefined) ?? undefined,
        parentId: (body.parentId as string | null | undefined) ?? undefined,
        repeat: repeatInput(body.repeat) ?? null,
        section: (body.section as string | null | undefined) ?? undefined,
        sortOrder: (body.sortOrder as number | null | undefined) ?? undefined,
        reminderLeadMinutes: (body.reminderLeadMinutes as number | null | undefined) ?? undefined,
        durationMinutes: (body.durationMinutes as number | null | undefined) ?? undefined,
      });
    case "task.update": {
      const patch = pick<Parameters<typeof updateTask>[1]>(body, [
        "title", "category", "description", "dueDate", "dueTime", "isCompleted", "projectId",
        "parentId", "section", "reminderLeadMinutes", "durationMinutes", "blockedReason",
        "blockedUntil", "pausedUntil",
      ]);
      if (Object.prototype.hasOwnProperty.call(body, "repeat")) {
        (patch as { repeat?: TaskRepeatInput | null }).repeat = repeatInput(body.repeat);
      }
      return updateTask(id(body), patch);
    }
    case "task.toggle":
      // api.ts's toggleTaskCompletion takes the task's CURRENT completion state, not the
      // desired one (the name is literal: it toggles). Pass task.isCompleted as-is.
      return toggleTaskCompletion(id(body), body.isCompleted === true);
    case "task.delete":
      return deleteTask(id(body));
    case "task.snooze":
      return snoozeTask(id(body), typeof body.days === "number" ? body.days : 1);
    case "task.reorder":
      if (!Array.isArray(body.ids)) fail('"ids" must be an array');
      return reorderTasks(body.ids as string[]);

    // --- Projects ---
    case "project.create":
      return createProject({
        name: requiredString(body, "name"),
        description: (body.description as string | null | undefined) ?? undefined,
        dueDate: (body.dueDate as string | null | undefined) ?? undefined,
        reminderLeadMinutes: (body.reminderLeadMinutes as number | null | undefined) ?? undefined,
        durationMinutes: (body.durationMinutes as number | null | undefined) ?? undefined,
      });
    case "project.update":
      return updateProject(
        id(body),
        pick<Parameters<typeof updateProject>[1]>(body, [
          "name", "description", "isCompleted", "dueDate", "reminderLeadMinutes", "durationMinutes",
        ])
      );
    case "project.delete":
      return deleteProject(id(body));
    case "project.setSections":
      return setProjectSections(id(body), body.enabled === true);
    case "project.duplicate":
      return duplicateProject(id(body), (body.name as string | null | undefined) ?? undefined);

    // --- Routines ---
    case "routine.create":
      return createRoutine({
        title: requiredString(body, "title"),
        reminderTime: requiredString(body, "reminderTime"),
        durationMinutes: (body.durationMinutes as number | null | undefined) ?? undefined,
        frequency: (body.frequency ?? "DAILY") as RoutineFrequency,
        interval: (body.interval as number | undefined) ?? undefined,
        daysOfWeek: (body.daysOfWeek as number[] | undefined) ?? undefined,
        monthlyMode: (body.monthlyMode as RoutineMonthlyMode | undefined) ?? undefined,
        dayOfMonth: (body.dayOfMonth as number | null | undefined) ?? undefined,
        monthlyOrdinal: (body.monthlyOrdinal as number | null | undefined) ?? undefined,
        monthlyWeekday: (body.monthlyWeekday as number | null | undefined) ?? undefined,
      });
    case "routine.update":
      return updateRoutine(
        id(body),
        pick<Parameters<typeof updateRoutine>[1]>(body, [
          "title", "reminderTime", "isActive", "pausedUntil", "durationMinutes",
          "frequency", "interval", "daysOfWeek", "monthlyMode", "dayOfMonth",
          "monthlyOrdinal", "monthlyWeekday",
        ])
      );
    case "routine.complete":
      return completeRoutineCluster(id(body));
    case "routine.untick":
      return untickRoutineCluster(id(body));
    case "routine.delete":
      return deleteRoutine(id(body));
    case "routine.createSubroutine":
      return createSubroutine(requiredString(body, "parentId"), requiredString(body, "title"));

    // --- Habits ---
    case "habit.create":
      return createHabit({
        title: requiredString(body, "title"),
        scheduleType: (body.scheduleType ?? "WEEKLY_DAYS") as HabitScheduleType,
        targetCount: (body.targetCount as number | undefined) ?? 1,
        daysOfWeek: (body.daysOfWeek as number[] | undefined) ?? [],
        durationMinutes: (body.durationMinutes as number | null | undefined) ?? undefined,
      });
    case "habit.update":
      return updateHabit(
        id(body),
        pick<Parameters<typeof updateHabit>[1]>(body, [
          "title", "scheduleType", "targetCount", "daysOfWeek", "durationMinutes", "pauseStart", "pauseEnd",
        ])
      );
    case "habit.complete":
      return completeHabit(id(body));
    case "habit.toggleCompletion":
      return toggleHabitCompletion(id(body), requiredString(body, "date"));
    case "habit.delete":
      return deleteHabit(id(body));

    // --- Notes ---
    case "note.create":
      return createNote({
        id: id(body),
        title: requiredString(body, "title"),
        projectId: (body.projectId as string | null | undefined) ?? undefined,
        taskId: (body.taskId as string | null | undefined) ?? undefined,
        body: (body.body as string | undefined) ?? undefined,
      });
    case "note.update":
      return updateNote(id(body), pick<Parameters<typeof updateNote>[1]>(body, ["title", "projectId"]));
    case "note.saveBody":
      // No hints: the server mints ids/categories for new checkbox lines, like the Obsidian bridge.
      return saveNoteBody(id(body), typeof body.body === "string" ? body.body : "");
    case "note.delete":
      return deleteNote(id(body));

    // --- Countdowns ---
    case "countdown.create":
      return createCountdown({
        title: requiredString(body, "title"),
        date: requiredString(body, "date"),
        repeatsYearly: body.repeatsYearly !== false,
      });
    case "countdown.update":
      return updateCountdown(id(body), {
        title: requiredString(body, "title"),
        date: requiredString(body, "date"),
        repeatsYearly: body.repeatsYearly !== false,
      });
    case "countdown.delete":
      return deleteCountdown(id(body));

    // --- Categories ---
    case "category.create":
      return createCategory(requiredString(body, "name"), (body.scope as CategoryScope | undefined) ?? "NONE");
    case "category.update":
      return updateCategory(id(body), requiredString(body, "name"));
    case "category.setScope":
      return updateCategoryScope(id(body), (body.scope as CategoryScope | undefined) ?? "NONE");
    case "category.delete":
      return deleteCategory(id(body));

    default:
      fail(`Unknown action "${action}"`);
  }
}

export async function POST(request: Request) {
  const denied = await nativeAuth(request);
  if (denied) return denied;

  let body: Json;
  try {
    body = (await request.json()) as Json;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (!action) return Response.json({ error: '"action" is required' }, { status: 400 });

  try {
    const result = await dispatch(action, body);
    return Response.json({ ok: true, result: result ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mutation failed" }, { status: 400 });
  }
}
