import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createTaskTool,
  listCalendarEvents,
  listCategories,
  listProjects,
  listTasks,
  setTaskCompleted,
  updateTaskTool,
} from "@/lib/assistant/tools";

// The MCP (Model Context Protocol) surface of Cura — the same tool set the in-app assistant
// uses (lib/assistant/openai.ts), exposed over Streamable HTTP so external MCP clients (Kimi,
// Claude Desktop, etc.) can read and manage the taskbook directly. Served by app/api/mcp/route.ts.

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function createCuraMcpServer(): McpServer {
  const server = new McpServer({ name: "cura", version: "1.0.0" });

  server.registerTool(
    "list_tasks",
    {
      description: "List the user's tasks, optionally filtered.",
      inputSchema: {
        completed: z.boolean().optional().describe("Only tasks with this completion state"),
        category: z.string().optional().describe("Only tasks in this exact category"),
        projectId: z.string().optional().describe("Only tasks belonging to this project id"),
        dueBefore: z.string().optional().describe("YYYY-MM-DD, only tasks due on or before this date"),
        dueAfter: z.string().optional().describe("YYYY-MM-DD, only tasks due on or after this date"),
        search: z.string().optional().describe("Substring to match against title/description"),
      },
    },
    async (args) => json(await listTasks(args))
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a new task.",
      inputSchema: {
        title: z.string(),
        category: z.string().optional().describe("Must exactly match one of the existing categories, otherwise omit it"),
        description: z.string().optional(),
        dueDate: z.string().optional().describe("YYYY-MM-DD, resolved from relative dates like 'tomorrow'"),
        dueTime: z.string().optional().describe("HH:MM 24h clock time"),
        projectId: z.string().optional().describe("Must exactly match one of the existing project ids"),
      },
    },
    async (args) => json(await createTaskTool(args))
  );

  server.registerTool(
    "update_task",
    {
      description: "Edit fields on an existing task. Only pass fields that should change.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        dueDate: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear it"),
        dueTime: z.string().optional(),
        projectId: z.string().nullable().optional().describe("or null to remove it from its project"),
      },
    },
    async (args) => json(await updateTaskTool(args))
  );

  server.registerTool(
    "set_task_completed",
    {
      description: "Mark a task complete or incomplete.",
      inputSchema: {
        id: z.string(),
        completed: z.boolean(),
      },
    },
    async (args) => json(await setTaskCompleted(args))
  );

  server.registerTool(
    "list_projects",
    {
      description: "List existing projects (id + name), e.g. to resolve a project name the user mentioned to its id.",
    },
    async () => json(await listProjects())
  );

  server.registerTool(
    "list_categories",
    {
      description: "List existing task categories.",
    },
    async () => json(await listCategories())
  );

  server.registerTool(
    "list_calendar_events",
    {
      description:
        "Read the user's synced calendar (Google + Outlook) so tasks can be scheduled around real commitments. " +
        "Read-only, covers today through roughly 60 days ahead only. Times are in the user's configured time zone.",
      inputSchema: {
        from: z.string().optional().describe("YYYY-MM-DD, only events on or after this date"),
        to: z.string().optional().describe("YYYY-MM-DD, only events on or before this date"),
        search: z.string().optional().describe("Substring to match against the event title/location"),
        includeDismissed: z.boolean().optional().describe("Include events the user hid in the app (default false)"),
      },
    },
    async (args) => json(await listCalendarEvents(args))
  );

  return server;
}
