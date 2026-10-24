import { getPageSnapshot } from "@/lib/api";
import { nativeAuth } from "../auth";

// The whole taskbook state in one round trip — the same snapshot the web page's SSR and
// pullState sync use, so the Mac client and the web client can never disagree on what a
// "full state" is. Dates serialize to ISO strings via Response.json.
export async function GET(request: Request) {
  const denied = await nativeAuth(request);
  if (denied) return denied;
  return Response.json(await getPageSnapshot());
}
