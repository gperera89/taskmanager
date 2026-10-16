import "server-only";

// Thin OpenAI structured-outputs client, matching the house style of the other OpenAI callers
// (lib/voice.ts, lib/email.ts, lib/assistant/openai.ts): raw fetch, no SDK, defensive
// coercion at the call site. Used by the AI suggestion generator (lib/suggestions.ts).

// The daily suggestion run is a structured-extraction job with explicit rules in the prompt —
// gpt-4o-mini is fast and cheap for it, the same model voice/email parsing uses.
export const OPENAI_JSON_MODEL = "gpt-4o-mini";

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

// One non-streaming chat completion constrained to a JSON schema (structured outputs), returning
// the parsed object — or null on any transport/shape failure, which callers treat as "no output"
// rather than an exception (the cron run should log-and-skip, not crash).
export async function openaiJson(input: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_JSON_MODEL,
      max_completion_tokens: input.maxTokens ?? 4096,
      // Structured outputs pin the response to the schema, so no fence-stripping is needed —
      // the JSON.parse guard below is belt-and-braces for refusals/truncation.
      response_format: {
        type: "json_schema",
        json_schema: { name: "response", schema: input.schema, strict: true },
      },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[openai-json] ${res.status}: ${detail.slice(0, 500)}`);
    return null;
  }

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  } | null;
  if (!data) return null;
  const message = data.choices?.[0]?.message;
  if (message?.refusal) {
    console.error("[openai-json] request refused");
    return null;
  }
  const text = message?.content;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.error("[openai-json] unparseable JSON response");
    return null;
  }
}
