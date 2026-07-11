-- One-off backfill accompanying the 2026-07-11 schema additions. Run once, after
-- `npx prisma db push`, via: npx prisma db execute --file prisma/backfill-2026-07-11.sql
--
-- 1. Tasks completed before completedAt existed get stamped "now" so the 30-day archive
--    window starts counting from the migration rather than keeping them visible forever.
UPDATE "Task" SET "completedAt" = now() WHERE "isCompleted" = true AND "completedAt" IS NULL;

-- 2. The two seeded categories keep their old hardcoded work/home behavior via the new
--    scope column (any other category now shows in BOTH modes instead of disappearing).
UPDATE "Category" SET "scope" = 'WORK' WHERE lower("name") = 'work' AND "scope" = 'NONE';
UPDATE "Category" SET "scope" = 'HOME' WHERE lower("name") = 'home' AND "scope" = 'NONE';
