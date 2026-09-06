import { auth } from "@/auth";
import { getStateVersion } from "@/lib/api";

// "Would a refresh actually bring anything new?" — one cheap query answering with a 32-byte
// fingerprint of every row the page reads (see STATE_FINGERPRINT_SQL in lib/api.ts). The client
// hits this on open and on focus instead of blindly re-rendering the whole page: unchanged
// fingerprint, no refresh, no re-derive, no UI churn.
//
// Session-authenticated. proxy.ts already covers this path; the check here is belt-and-braces,
// matching the other API routes.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { version, lastCronAtMs } = await getStateVersion();
  return Response.json({ v: version, lastCronAtMs }, { headers: { "Cache-Control": "no-store" } });
}
