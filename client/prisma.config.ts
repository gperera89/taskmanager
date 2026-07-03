import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Match Next.js's own convention of keeping local secrets in .env.local.
config({ path: ".env.local" });

export default defineConfig({
	datasource: {
		url: env("DATABASE_URL"),
	},
});
