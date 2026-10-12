import { auth } from "@/auth";
import { deliver } from "@/lib/notifications";

// "Send test notification" button in Settings — removes the guesswork when checking whether
// a device/channel actually receives anything. Session-authenticated (proxy.ts covers this
// path, but double-check here since it triggers outbound sends).
export async function POST() {
  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Which channel took it — "push" means Cura's own notification reached at least one device,
  // "ntfy" that it fell back (no device signed up, or every subscription gone).
  const channel = await deliver({
    title: "Cura test notification",
    body: `Sent ${new Date().toUTCString()} — if you can read this, delivery works.`,
    url: "/",
    tag: "test",
  });
  return Response.json({ ok: true, channel });
}
