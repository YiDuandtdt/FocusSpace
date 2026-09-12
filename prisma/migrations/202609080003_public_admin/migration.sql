ALTER TABLE "User" ADD COLUMN "bannedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "banReason" TEXT;
ALTER TABLE "Room" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "Room" ADD COLUMN "delistedAt" DATETIME;
ALTER TABLE "ChatMessage" ADD COLUMN "removedAt" DATETIME;
CREATE TABLE "AdminAudit" (
 "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "action" TEXT NOT NULL,
 "targetId" TEXT NOT NULL, "reason" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "result" TEXT NOT NULL, "summary" TEXT NOT NULL, "requestId" TEXT NOT NULL
);
CREATE INDEX "AdminAudit_createdAt_id_idx" ON "AdminAudit"("createdAt", "id");
CREATE INDEX "Room_visibility_createdAt_idx" ON "Room"("visibility", "createdAt");
