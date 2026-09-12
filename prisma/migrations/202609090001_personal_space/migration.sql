ALTER TABLE "User" ADD COLUMN "avatarImage" BLOB;
ALTER TABLE "User" ADD COLUMN "avatarVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "characterConfig" TEXT NOT NULL DEFAULT '{"version":1,"skin":"skin.cream","hair":"hair.crop","hairColor":"hair.ink","outfit":"outfit.sage","accessory":"accessory.none"}';
ALTER TABLE "User" ADD COLUMN "onboarding" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Room" ADD COLUMN "spaceSnapshot" TEXT;
ALTER TABLE "Room" ADD COLUMN "spaceOwnerId" TEXT;
CREATE TABLE "PersonalSpace" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "config" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonalSpace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "PersonalSpace" ("userId", "config") SELECT "id", '{"version":1,"room":"room.atelier","theme":"library","desk":"desk.oak","chair":"chair.sage","light":"light.day","slots":{"desktop":"desktop.tea","wall":"wall.botanical","window":"window.fern","rug":"rug.moss"},"sound":"birds"}' FROM "User";
UPDATE "User" SET "onboarding" = 'SKIPPED';
