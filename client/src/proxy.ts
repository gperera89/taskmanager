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
	// api/mcp is the same story for the Claude MCP connector, which authenticates via a secret
	// embedded in the URL path instead of a session cookie (see api/mcp/[secret]/route.ts).
	// api/notify-action is hit by ntfy notification action buttons carrying the cron secret.
	// api/email-inbound is the Postmark inbound webhook, authenticated by a secret in the URL path
	// (see api/email-inbound/[secret]/route.ts) plus a sender allowlist.
	// sw.js must load without a session so the service worker can register/update on any device.
	matcher: ["/((?!api/auth|api/cron|api/voice-capture|api/mcp|api/notify-action|api/email-inbound|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|sw.js|manifest.webmanifest).*)"],
};
