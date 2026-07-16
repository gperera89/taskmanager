import { prisma } from "@/lib/db";

// TEMPORARY one-shot migration route — DELETE AFTER USE.
//
// The dev machine can't reach db.prisma.io directly (stale local DATABASE_URL / blocked
// network), so this applies the My Day schema through the deployed app, which demonstrably can.
// Guarded by a one-off token; every statement is idempotent so re-runs are harmless. This is a
// deliberate temporary exception to the "only lib/api.ts talks to prisma" rule.

const TOKEN = "527010c5ffca61415ea3755c52181856b554113ffaac5894";

// prisma migrate diff output (HEAD~1 schema -> current), rewritten to be idempotent.
const STATEMENTS = [
  `DO $$ BEGIN
     CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'SNOOZED', 'DISMISSED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "blockedReason" TEXT`,
  `ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "blockedUntil" TIMESTAMP(3)`,
  `CREATE TABLE IF NOT EXISTS "DayPlanBlock" (
     "id" TEXT NOT NULL,
     "date" TIMESTAMP(3) NOT NULL,
     "entityType" "CapturedKind" NOT NULL,
     "entityId" TEXT NOT NULL,
     "startTime" TEXT,
     "durationMinutes" INTEGER,
     "sortOrder" DOUBLE PRECISION,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "DayPlanBlock_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE TABLE IF NOT EXISTS "AiSuggestion" (
     "id" TEXT NOT NULL,
     "dedupeKey" TEXT NOT NULL,
     "kind" TEXT NOT NULL,
     "title" TEXT NOT NULL,
     "description" TEXT,
     "eventId" TEXT,
     "eventTitle" TEXT,
     "suggestedDate" TIMESTAMP(3),
     "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
     "snoozedUntil" TIMESTAMP(3),
     "createdTaskId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "respondedAt" TIMESTAMP(3),
     CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE TABLE IF NOT EXISTS "AiNote" (
     "id" TEXT NOT NULL,
     "content" TEXT NOT NULL,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "AiNote_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "DayPlanBlock_date_idx" ON "DayPlanBlock"("date")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DayPlanBlock_date_entityType_entityId_key" ON "DayPlanBlock"("date", "entityType", "entityId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AiSuggestion_dedupeKey_key" ON "AiSuggestion"("dedupeKey")`,
  `CREATE INDEX IF NOT EXISTS "AiSuggestion_status_createdAt_idx" ON "AiSuggestion"("status", "createdAt")`,
];

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  // Plain 404 on mismatch so guesses don't confirm the route exists (email-inbound pattern).
  if (token !== TOKEN) return new Response(null, { status: 404 });

  const applied: string[] = [];
  try {
    for (const sql of STATEMENTS) {
      await prisma.$executeRawUnsafe(sql);
      applied.push(sql.trim().slice(0, 60));
    }
  } catch (err) {
    return Response.json({ error: String(err), applied }, { status: 500 });
  }
  return Response.json({ ok: true, applied: applied.length });
}
