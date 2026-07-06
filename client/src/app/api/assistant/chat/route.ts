import { auth } from "@/auth";
import { runAssistantChat, type ChatMessage } from "@/lib/assistant/openai";

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const messages = Array.isArray(body?.messages) ? body.messages.filter(isChatMessage) : null;
  if (!messages || messages.length === 0) {
    return Response.json({ error: "messages is required" }, { status: 400 });
  }

  try {
    const result = await runAssistantChat(messages);
    return Response.json(result);
  } catch (err) {
    console.error("[assistant/chat] failed:", err);
    const message = err instanceof Error ? err.message : "Chat failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
