/*
  Warnings:

  - Made the column `sourceKey` on table `Decision` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Decision" ALTER COLUMN "sourceKey" SET NOT NULL;
