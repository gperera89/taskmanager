# MCP server (external AI clients)

Cura exposes a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at
`/api/mcp` (Streamable HTTP, stateless, JSON responses). External MCP clients — Kimi, Claude
Desktop, Cursor, etc. — can use it to read and manage the taskbook directly.

It serves the same tool set as the in-app assistant (see `src/lib/assistant/tools.ts`), wired up
in `src/lib/assistant/mcp.ts`:

| Tool | Effect |
|---|---|
| `list_tasks` | List tasks, filterable by completion / category / project / due range / search |
| `create_task` | Create a task (title, category, description, due date/time, project) |
| `update_task` | Edit fields on an existing task |
| `set_task_completed` | Mark a task complete or incomplete (repeating tasks roll forward) |
| `list_projects` | List projects (id + name) |
| `list_categories` | List task categories |
| `list_calendar_events` | Read-only view of the synced Google/Outlook calendars |

## Authentication

Bearer secret, same convention as `/api/cron`:

```
Authorization: Bearer <MCP_SECRET>
```

`MCP_SECRET` lives in `.env.local` (and in the Vercel project env for the deployed app). The
route rejects everything when the variable is unset. The endpoint is exempt from the session
redirect in `src/proxy.ts` — it does its own auth, like the cron route.

## Connecting a client

Point any remote-MCP-capable client at:

```
https://<app-domain>/api/mcp        # deployed app
http://localhost:3000/api/mcp       # local dev server
```

with the `Authorization: Bearer <MCP_SECRET>` header. Example mcp.json entry:

```json
{
  "mcpServers": {
    "cura": {
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer <MCP_SECRET>" }
    }
  }
}
```

## Notes

- Stateless by design: no session ids, one server instance per request, so it runs fine on
  serverless with no shared state.
- Due dates follow the app's face-value encoding (see `combineDueDateTime` in
  `src/lib/shared.ts`): pass calendar dates as `YYYY-MM-DD` and times as 24h `HH:MM`; the tools
  handle the storage encoding.
- `list_calendar_events` shares the app's 5-minute ICS cache, so polling it is cheap.
