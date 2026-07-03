import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Single-user app: only this account may sign in.
const ALLOWED_EMAILS = new Set(["g.perera26@gmail.com"]);

export const { handlers, signIn, signOut, auth } = NextAuth({
	providers: [Google],
	callbacks: {
		signIn({ user }) {
			return !!user.email && ALLOWED_EMAILS.has(user.email);
		},
	},
});
