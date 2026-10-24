import { auth } from "@/auth";

// The native Mac client can't hold a Google login cookie, so it authenticates with a shared
// secret header — the same pattern as the iPhone Shortcut (api/voice-capture). NATIVE_API_SECRET
// wins when set; SHORTCUT_SECRET is the fallback so no new deployment config is needed. A Google
// session (e.g. opening the endpoint from a logged-in browser) also passes, which keeps casual
// debugging easy.
export async function nativeAuth(request: Request): Promise<Response | null> {
  const secret = process.env.NATIVE_API_SECRET ?? process.env.SHORTCUT_SECRET;
  if (secret && request.headers.get("x-native-secret") === secret) return null;
  const session = await auth();
  if (session) return null;
  return Response.json({ error: "Not authenticated" }, { status: 401 });
}
