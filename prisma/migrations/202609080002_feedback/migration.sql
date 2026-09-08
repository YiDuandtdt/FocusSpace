ALTER TABLE "Task" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "Task" ADD COLUMN "firstCompletedRound" INTEGER;
ALTER TABLE "StudySession" ADD COLUMN "feedbackVersion" INTEGER NOT NULL DEFAULT 1;
UPDATE "StudySession" SET "feedbackVersion" = 0;
CREATE INDEX "StudyRecord_userId_id_idx" ON "StudyRecord"("userId", "id");
