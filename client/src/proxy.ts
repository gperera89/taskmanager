import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
	if (!req.auth) {
		const signInUrl = new URL("/api/auth/signin", req.url);
		signInUrl.searchParams.set("callbackUrl", req.url);
		return NextResponse.redirect(signInUrl);
	}
});

export const config = {
	// api/voice-capture is exempt because it does its own auth (Google session OR X-Shortcut-Secret,
	// for the iPhone Shortcut which can't hold a login cookie), same as api/cron's secret check.
	// api/notify-action is hit by ntfy notification action buttons carrying the cron secret.
	// api/email-inbound is the Postmark inbound webhook, authenticated by a secret in the URL path
	// (see api/email-inbound/[secret]/route.ts) plus a sender allowlist.
	// api/habit-log takes a bearer secret from the Stoic journal (see api/habit-log/[id]/route.ts).
	// api/vault-sync takes a bearer secret from the Cura Bridge Obsidian plugin (see its route).
	// api/mcp is the MCP endpoint for external AI clients, bearer-secret authed (see api/mcp/route.ts).
	// sw.js must load without a session so the service worker can register/update on any device.
	matcher: ["/((?!api/auth|api/cron|api/voice-capture|api/notify-action|api/email-inbound|api/habit-log|api/vault-sync|api/mcp|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|sw.js|manifest.webmanifest).*)"],
};
