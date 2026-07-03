import { auth } from "@/auth";
import {
  createHabit,
  createProject,
  createRoutine,
  createTask,
  createVoiceCaptureNotice,
  getCategories,
  getProjects,
} from "@/lib/api";
import { parseCaptureFromTranscript, transcribeAudio } from "@/lib/voice";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "No audio provided" }, { status: 400 });
  }

  try {
    const transcript = await transcribeAudio(audio);
    const [categories, projects] = await Promise.all([getCategories(), getProjects()]);
    const parsed = await parseCaptureFromTranscript(
      transcript,
      categories.map((c) => c.name),
      projects.map((p) => ({ id: p.id, name: p.name }))
    );

    let entityId: string;
    let summary: string;
    switch (parsed.kind) {
      case "PROJECT": {
        const project = await createProject(parsed.project);
        entityId = project.id;
        summary = project.name;
        break;
      }
      case "ROUTINE": {
        const routine = await createRoutine(parsed.routine);
        entityId = routine.id;
        summary = routine.title;
        break;
      }
      case "HABIT": {
        const habit = await createHabit(parsed.habit);
        entityId = habit.id;
        summary = habit.title;
        break;
      }
      default: {
        // The AI may not have matched an existing category — Task requires a non-empty one.
        const category = parsed.task.category || categories[0]?.name || "Personal";
        const task = await createTask({ ...parsed.task, category });
        entityId = task.id;
        summary = task.title;
        break;
      }
    }

    const notice = await createVoiceCaptureNotice({
      transcript,
      kind: parsed.kind,
      entityId,
      summary,
      parseError: parsed.parseError,
    });
    return Response.json({ notice });
  } catch (err) {
    console.error("[voice-capture] failed:", err);
    const message = err instanceof Error ? err.message : "Voice capture failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
