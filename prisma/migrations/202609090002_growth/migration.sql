ALTER TABLE "StudySession" ADD COLUMN "rewardRules" TEXT;
ALTER TABLE "StudyRecord" ADD COLUMN "rewardState" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "StudyRecord" ADD COLUMN "rewardFacts" TEXT;
ALTER TABLE "StudyRecord" ADD COLUMN "settledAt" DATETIME;
CREATE TABLE "GrowthAccount" ("userId" TEXT NOT NULL PRIMARY KEY, "xp" INTEGER NOT NULL DEFAULT 0 CHECK("xp">=0), "coins" INTEGER NOT NULL DEFAULT 0 CHECK("coins">=0), "level" INTEGER NOT NULL DEFAULT 1);
CREATE TABLE "GrowthItem" ("id" TEXT NOT NULL PRIMARY KEY, "price" INTEGER NOT NULL CHECK("price">=0), "minLevel" INTEGER NOT NULL CHECK("minLevel">=1), "status" TEXT NOT NULL DEFAULT 'ACTIVE');
CREATE TABLE "OwnedAsset" ("userId" TEXT NOT NULL, "assetId" TEXT NOT NULL, "source" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("userId", "assetId"));
CREATE TABLE "GrowthLedger" ("id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "userId" TEXT NOT NULL, "source" TEXT NOT NULL, "recordId" TEXT, "assetId" TEXT, "ruleVersion" INTEGER NOT NULL, "xp" INTEGER NOT NULL, "coins" INTEGER NOT NULL, "xpAfter" INTEGER NOT NULL, "coinsAfter" INTEGER NOT NULL, "rewardDay" TEXT, "goalBonus" BOOLEAN NOT NULL DEFAULT false, "togetherBonus" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "GrowthLedger_key_key" ON "GrowthLedger"("key");
CREATE UNIQUE INDEX "GrowthLedger_recordId_key" ON "GrowthLedger"("recordId");
CREATE INDEX "GrowthLedger_userId_createdAt_idx" ON "GrowthLedger"("userId", "createdAt");
CREATE TABLE "GrowthSettings" ("id" TEXT NOT NULL PRIMARY KEY, "rules" TEXT NOT NULL);
-- Existing data stays historical. Remember only legacy users' currently equipped assets.
INSERT INTO "GrowthAccount" ("userId") SELECT "id" FROM "User";
INSERT OR IGNORE INTO "OwnedAsset" ("userId","assetId","source") SELECT u.id, j.value, 'MIGRATION' FROM User u, json_each(u.characterConfig) j WHERE j.type='text';
INSERT OR IGNORE INTO "OwnedAsset" ("userId","assetId","source") SELECT p.userId, j.value, 'MIGRATION' FROM PersonalSpace p, json_tree(p.config) j WHERE j.type='text' AND j.key NOT IN ('theme','sound');
INSERT OR IGNORE INTO "OwnedAsset" ("userId","assetId","source") SELECT userId, 'sound.' || json_extract(config,'$.sound'), 'MIGRATION' FROM PersonalSpace WHERE json_extract(config,'$.sound') IS NOT NULL;
