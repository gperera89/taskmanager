import { auth } from "@/auth";
import { deletePushSubscription, savePushSubscription } from "@/lib/api";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const endpoint = String(body?.endpoint ?? "");
  const p256dh = String(body?.keys?.p256dh ?? "");
  const auth_ = String(body?.keys?.auth ?? "");
  if (!endpoint || !p256dh || !auth_) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  await savePushSubscription({ endpoint, p256dh, auth: auth_ });
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();
  const endpoint = String(body?.endpoint ?? "");
  if (!endpoint) return Response.json({ error: "Invalid endpoint" }, { status: 400 });

  await deletePushSubscription(endpoint);
  return Response.json({ ok: true });
}
