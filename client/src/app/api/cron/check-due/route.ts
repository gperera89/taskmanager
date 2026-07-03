import { checkAndNotifyDueItems } from "@/lib/notifications";

// Hit on a short interval (e.g. every minute) by an external scheduler — see the project's
// notification setup notes for why this isn't Vercel's own Cron (Hobby plan caps it at 1/day).
// Authenticated with a shared secret rather than a user session since the caller is a machine.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkAndNotifyDueItems();
  return Response.json(result);
}
