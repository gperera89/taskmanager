import "server-only";

// Thin Anthropic Messages API client, matching the house style of the OpenAI callers
// (lib/voice.ts, lib/email.ts, lib/assistant/openai.ts): raw fetch, no SDK, defensive
// coercion at the call site. Used by the My Day suggestion generator (lib/suggestions.ts).

// The daily suggestion run is a structured-extraction job with explicit rules in the prompt —
// Haiku is fast and cheap for it. Swap to "claude-sonnet-5" if quality disappoints.
export const ANTHROPIC_MODEL = "claude-haiku-4-5";

function requireApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  return key;
}

// One non-streaming messages call constrained to a JSON schema (structured outputs), returning
// the parsed object — or null on any transport/shape failure, which callers treat as "no output"
// rather than an exception (the cron run should log-and-skip, not crash).
export async function anthropicJson(input: {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": requireApiKey(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: input.maxTokens ?? 4096,
      system: input.system,
      // Structured outputs pin the response to the schema, so no fence-stripping is needed —
      // the JSON.parse guard below is belt-and-braces for refusals/truncation.
      output_config: { format: { type: "json_schema", schema: input.schema } },
      messages: [{ role: "user", content: input.user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[anthropic] ${res.status}: ${detail.slice(0, 500)}`);
    return null;
  }

  const data = (await res.json().catch(() => null)) as {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  } | null;
  if (!data) return null;
  if (data.stop_reason === "refusal") {
    console.error("[anthropic] request refused");
    return null;
  }
  const text = data.content?.find((b) => b.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    console.error("[anthropic] unparseable JSON response");
    return null;
  }
}
