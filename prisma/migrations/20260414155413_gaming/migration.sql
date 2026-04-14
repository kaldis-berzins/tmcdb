/*
  Warnings:

  - The values [CJEU] on the enum `Institution` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `title` on the `Decision` table. All the data in the column will be lost.
  - Added the required column `source` to the `Decision` table without a default value. This is not possible if the table is not empty.
  - Made the column `caseNumber` on table `Decision` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('EUIPO', 'IUROPA', 'MANUAL', 'OTHER');

-- AlterEnum
BEGIN;
CREATE TYPE "Institution_new" AS ENUM ('CD', 'BOA', 'GC', 'ECJ', 'OTHER');
ALTER TABLE "Decision" ALTER COLUMN "institution" TYPE "Institution_new" USING ("institution"::text::"Institution_new");
ALTER TYPE "Institution" RENAME TO "Institution_old";
ALTER TYPE "Institution_new" RENAME TO "Institution";
DROP TYPE "public"."Institution_old";
COMMIT;

-- AlterTable
ALTER TABLE "Decision" DROP COLUMN "title",
ADD COLUMN     "source" "SourceType" NOT NULL,
ALTER COLUMN "caseNumber" SET NOT NULL;
