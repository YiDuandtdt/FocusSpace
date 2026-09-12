ALTER TABLE "StudySession" ADD COLUMN "targetRounds" INTEGER;

ALTER TABLE "Task" ADD COLUMN "todoId" TEXT;
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Task" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Task" ADD COLUMN "dueAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "labels" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "Todo" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "parentId" TEXT,
  "title" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "completedAt" DATETIME,
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "dueAt" DATETIME,
  "scheduledStart" DATETIME,
  "scheduledEnd" DATETIME,
  "labels" TEXT NOT NULL DEFAULT '[]',
  "recurrence" TEXT NOT NULL DEFAULT 'NONE',
  "seriesId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Todo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Todo_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Todo" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Todo_userId_archivedAt_dueAt_idx" ON "Todo"("userId", "archivedAt", "dueAt");
CREATE INDEX "Todo_parentId_idx" ON "Todo"("parentId");
CREATE INDEX "Todo_seriesId_idx" ON "Todo"("seriesId");
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");
CREATE INDEX "Task_todoId_idx" ON "Task"("todoId");
CREATE UNIQUE INDEX "Task_sessionId_userId_todoId_key" ON "Task"("sessionId", "userId", "todoId");
