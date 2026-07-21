import { createMcpHandler } from "mcp-handler";
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

function jsonContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

// A fresh McpServer per request (mcp-handler's own model — see its mcpApiHandler, which spins
// up a new McpServer + transport per POST), registering the same tools the in-app chat uses
// (client/src/lib/assistant/tools.ts) so both surfaces share one implementation of "what an
// assistant can do to this app's tasks."
function buildHandler(secret: string) {
  return createMcpHandler(
    (server) => {
      server.tool(
        "list_tasks",
        "List the user's tasks, optionally filtered by completion, category, project, due date range, or a text search.",
        {
          completed: z.boolean().optional(),
          category: z.string().optional(),
          projectId: z.string().optional(),
          dueBefore: z.string().optional().describe("YYYY-MM-DD, only tasks due on or before this date"),
          dueAfter: z.string().optional().describe("YYYY-MM-DD, only tasks due on or after this date"),
          search: z.string().optional().describe("Substring to match against title/description"),
        },
        async (args) => jsonContent(await listTasks(args))
      );

      server.tool(
        "create_task",
        "Create a new task.",
        {
          title: z.string(),
          category: z.string().optional().describe("Must exactly match an existing category, otherwise omit it"),
          description: z.string().optional(),
          dueDate: z.string().optional().describe("YYYY-MM-DD, resolved from relative dates like 'tomorrow'"),
          dueTime: z.string().optional().describe("HH:MM 24h clock time"),
          projectId: z.string().optional().describe("Must exactly match an existing project id"),
        },
        async (args) => jsonContent(await createTaskTool(args))
      );

      server.tool(
        "update_task",
        "Edit fields on an existing task. Only pass the fields that should change.",
        {
          id: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          dueDate: z.string().nullable().optional().describe("YYYY-MM-DD, or null to clear it"),
          dueTime: z.string().optional(),
          projectId: z.string().nullable().optional().describe("or null to remove it from its project"),
        },
        async (args) => jsonContent(await updateTaskTool(args))
      );

      server.tool(
        "set_task_completed",
        "Mark a task complete or incomplete.",
        { id: z.string(), completed: z.boolean() },
        async (args) => jsonContent(await setTaskCompleted(args))
      );

      server.tool("list_projects", "List existing projects (id + name).", {}, async () =>
        jsonContent(await listProjects())
      );

      server.tool("list_categories", "List existing task categories.", {}, async () =>
        jsonContent(await listCategories())
      );

      server.tool(
        "list_calendar_events",
        "Read the user's synced calendar (Google + Outlook), so tasks can be scheduled around real commitments. " +
          "Read-only, and only covers today through roughly 60 days ahead — the feeds carry no past events. " +
          "Times are in the user's configured time zone.",
        {
          from: z.string().optional().describe("YYYY-MM-DD, only events on or after this date"),
          to: z.string().optional().describe("YYYY-MM-DD, only events on or before this date"),
          search: z.string().optional().describe("Substring to match against the event title/location"),
          includeDismissed: z
            .boolean()
            .optional()
            .describe("Include events the user has hidden in the app (default false)"),
        },
        async (args) => jsonContent(await listCalendarEvents(args))
      );
    },
    { serverInfo: { name: "taskmanager", version: "1.0.0" } },
    // The request's real pathname includes the secret (see handle() below), so the endpoint
    // this library matches against has to include it too.
    { streamableHttpEndpoint: `/api/mcp/${secret}`, disableSse: true }
  );
}

async function handle(request: Request, ctx: RouteContext<"/api/mcp/[secret]">) {
  const { secret } = await ctx.params;
  // Wrong/missing secret returns a plain 404 rather than 401, so a guessed path doesn't even
  // confirm this route exists — same shared-secret spirit as SHORTCUT_SECRET/CRON_SECRET,
  // just carried in the URL since MCP client UIs vary in whether they let you set headers.
  if (!process.env.MCP_SECRET || secret !== process.env.MCP_SECRET) {
    return new Response("Not found", { status: 404 });
  }
  return buildHandler(secret)(request);
}

export { handle as DELETE, handle as GET, handle as POST };
