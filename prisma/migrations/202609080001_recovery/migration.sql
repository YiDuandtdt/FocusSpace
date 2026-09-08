-- Preserve reconnect deadlines across restarts; never reset existing data.
ALTER TABLE "RoomMember" ADD COLUMN "reconnectDeadlineAt" DATETIME;
CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
ALTER TABLE "CommandReceipt" ADD COLUMN "roomId" TEXT;
UPDATE "CommandReceipt" SET "roomId" = COALESCE(
  json_extract("result", '$.roomId'),
  (SELECT "roomId" FROM "ChatMessage" WHERE "ChatMessage"."userId" = "CommandReceipt"."userId"
    AND "ChatMessage"."requestId" = "CommandReceipt"."requestId")
);
