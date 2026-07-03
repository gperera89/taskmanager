import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Reuse the client across hot reloads in dev so we don't exhaust DB connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Hosted Postgres closes idle connections server-side; without keepAlive/idleTimeoutMillis
// and error listeners, a pooled connection can go bad silently and every query fails until
// the process restarts. Recycling idle clients proactively (well before the server's own
// timeout) and logging pool errors instead of leaving them unhandled avoids that.
const adapter = new PrismaPg(
  {
    connectionString: process.env.DATABASE_URL,
    keepAlive: true,
    idleTimeoutMillis: 10_000,
  },
  {
    onPoolError: (err) => console.error("[prisma] pg pool error:", err),
    onConnectionError: (err) => console.error("[prisma] pg connection error:", err),
  }
);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
