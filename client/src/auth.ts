import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

// Single-user app: only this account may sign in.
const ALLOWED_EMAILS = new Set(["g.perera26@gmail.com"]);
const [ALLOWED_EMAIL] = ALLOWED_EMAILS;

// Dev-only bypass so headless/automated tools can authenticate without the Google OAuth flow.
// Inert unless both NODE_ENV !== "production" and DEV_BYPASS_SECRET is set — remove this
// provider block (and the env var) once no longer needed.
const devBypassSecret = process.env.NODE_ENV !== "production" ? process.env.DEV_BYPASS_SECRET : undefined;

export const { handlers, signIn, signOut, auth } = NextAuth({
	providers: [
		Google,
		...(devBypassSecret
			? [
					Credentials({
						id: "dev-bypass",
						name: "Dev bypass",
						credentials: { secret: { label: "Secret", type: "password" } },
						authorize(credentials) {
							if (credentials?.secret !== devBypassSecret) return null;
							return { id: "dev-bypass", email: ALLOWED_EMAIL, name: "Dev" };
						},
					}),
				]
			: []),
	],
	callbacks: {
		signIn({ user, account }) {
			if (account?.provider === "dev-bypass") return true;
			return !!user.email && ALLOWED_EMAILS.has(user.email);
		},
	},
});
