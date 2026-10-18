import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createCuraMcpServer } from "@/lib/assistant/mcp";

// MCP endpoint for external clients (Kimi, Claude Desktop, ...) — see docs/mcp.md.
// Authenticated with a shared bearer secret rather than a user session since the caller is a
// machine, same convention as api/cron. Exempt from the session redirect in proxy.ts.
//
// Stateless mode (no session ids): each request gets a fresh server + transport pair, so the
// route works on any number of serverless instances with no shared state — the tool surface is
// a thin wrapper over the database. enableJsonResponse keeps replies plain JSON instead of SSE.
async function handle(request: Request): Promise<Response> {
  // Guard against a missing secret: without this, an unset MCP_SECRET would make the expected
  // header literally "Bearer undefined", which any caller could send to pass the check.
  const secret = process.env.MCP_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const server = createCuraMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
