import "server-only";
import {
  createTaskTool,
  listCategories,
  listProjects,
  listTasks,
  setTaskCompleted,
  updateTaskTool,
  type CreateTaskArgs,
  type ListTasksArgs,
  type SetTaskCompletedArgs,
  type UpdateTaskArgs,
} from "@/lib/assistant/tools";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_TOOL_ROUNDS = 5;

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Tool names that mutate data — used to tell the caller whether to refresh the page after the
// chat turn completes, same as the router.refresh() voice capture already does after a capture.
const MUTATING_TOOLS = new Set(["create_task", "update_task", "set_task_completed"]);

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_tasks",
      description: "List the user's tasks, optionally filtered. Use this to answer any question about existing tasks before answering.",
      parameters: {
        type: "object",
        properties: {
          completed: { type: "boolean", description: "Only tasks with this completion state" },
          category: { type: "string", description: "Only tasks in this exact category" },
          projectId: { type: "string", description: "Only tasks belonging to this project id" },
          dueBefore: { type: "string", description: "YYYY-MM-DD, only tasks due on or before this date" },
          dueAfter: { type: "string", description: "YYYY-MM-DD, only tasks due on or after this date" },
          search: { type: "string", description: "Substring to match against title/description" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description: "Create a new task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          category: { type: "string", description: "Must exactly match one of the existing categories, otherwise omit it" },
          description: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD, resolved from relative dates like 'tomorrow'" },
          dueTime: { type: "string", description: "HH:MM 24h clock time" },
          projectId: { type: "string", description: "Must exactly match one of the existing project ids" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task",
      description: "Edit fields on an existing task. Only pass fields that should change.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD, or null to clear it" },
          dueTime: { type: "string" },
          projectId: { type: "string", description: "or null to remove it from its project" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_task_completed",
      description: "Mark a task complete or incomplete.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          completed: { type: "boolean" },
        },
        required: ["id", "completed"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description: "List existing projects (id + name), e.g. to resolve a project name the user mentioned to its id.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_categories",
      description: "List existing task categories.",
      parameters: { type: "object", properties: {} },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_tasks":
      return listTasks(args as ListTasksArgs);
    case "create_task":
      return createTaskTool(args as unknown as CreateTaskArgs);
    case "update_task":
      return updateTaskTool(args as unknown as UpdateTaskArgs);
    case "set_task_completed":
      return setTaskCompleted(args as unknown as SetTaskCompletedArgs);
    case "list_projects":
      return listProjects();
    case "list_categories":
      return listCategories();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function requireApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  return key;
}

function systemPrompt(): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `You are the assistant embedded in the user's task manager app. Today is ${today} (${WEEKDAY_NAMES[now.getDay()]}).
Use the list_tasks/list_projects/list_categories tools to look up real data before answering questions or before creating/editing a task, rather than guessing — never invent task ids, project ids, or category names.
When the user asks a question about their tasks, call list_tasks with suitable filters and answer concisely in prose, don't dump raw JSON.
When the user asks you to add, reschedule, recategorize, or complete a task, call the matching tool, then confirm briefly what you did in one short sentence.
If a request is ambiguous (e.g. which task they mean), ask a clarifying question instead of guessing.`;
}

type OpenAIMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function chatCompletion(messages: OpenAIMessage[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, tools: TOOLS }),
  });
  if (!res.ok) {
    throw new Error(`Chat completion failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

export type AssistantChatResult = { reply: string; mutated: boolean };

// Runs one user turn of the tool-calling loop: sends the conversation + tool defs, executes any
// tool calls the model makes, feeds the results back, and repeats until it replies with plain
// text (or the round cap is hit, in which case we surface whatever text it has so far).
export async function runAssistantChat(history: ChatMessage[]): Promise<AssistantChatResult> {
  const messages: OpenAIMessage[] = [
    { role: "system", content: systemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
  let mutated = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const data = await chatCompletion(messages);
    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls as
      | { id: string; function: { name: string; arguments: string } }[]
      | undefined;

    if (!toolCalls || toolCalls.length === 0) {
      return { reply: String(message?.content ?? "").trim() || "Done.", mutated };
    }

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: tc.function })),
    });

    for (const call of toolCalls) {
      if (MUTATING_TOOLS.has(call.function.name)) mutated = true;
      let resultContent: string;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        resultContent = JSON.stringify(await callTool(call.function.name, args));
      } catch (err) {
        resultContent = JSON.stringify({ error: err instanceof Error ? err.message : "Tool call failed" });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: resultContent });
    }
  }

  return { reply: "I did a few things but I'm not sure I finished — could you check and re-ask if needed?", mutated };
}
