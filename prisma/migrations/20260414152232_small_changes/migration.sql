/*
  Warnings:

  - You are about to drop the column `source` on the `Decision` table. All the data in the column will be lost.
  - Added the required column `institution` to the `Decision` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Institution" AS ENUM ('CD', 'BOA', 'GC', 'CJEU', 'OTHER');

-- AlterTable
ALTER TABLE "Decision" DROP COLUMN "source",
ADD COLUMN     "institution" "Institution" NOT NULL;

-- DropEnum
DROP TYPE "DecisionSource";
