import { generateSuggestions } from "@/lib/suggestions";

// Hit once early each morning (e.g. ~05:30) by the external scheduler, so today's AI planner
// suggestions are waiting before the day starts. Same shared-secret auth as check-due.
export async function GET(request: Request) {
  // Guard against a missing secret: without this, an unset CRON_SECRET would make the expected
  // header literally "Bearer undefined", which any caller could send to pass the check.
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await generateSuggestions();
    return Response.json(result);
  } catch (err) {
    console.error("[cron/generate-suggestions]", err);
    return Response.json({ error: "Generation failed" }, { status: 500 });
  }
}
