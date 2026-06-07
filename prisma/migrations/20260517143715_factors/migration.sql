/*
  Warnings:

  - You are about to drop the column `value` on the `DecisionFactor` table. All the data in the column will be lost.
  - You are about to drop the column `key` on the `Factor` table. All the data in the column will be lost.
  - Added the required column `category` to the `Factor` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "FactorCategory" AS ENUM ('CONDUCT', 'RELATIONSHIP', 'DOCTRINAL', 'INFERENCE_BASIS');

-- CreateEnum
CREATE TYPE "BadFaithOutcome" AS ENUM ('CANCELLED', 'REJECTED', 'PARTIAL', 'REMITTED', 'UNCLEAR');

-- DropIndex
DROP INDEX "DecisionFactor_factorId_value_idx";

-- DropIndex
DROP INDEX "Factor_key_key";

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "badFaithOutcome" "BadFaithOutcome";

-- AlterTable
ALTER TABLE "DecisionFactor" DROP COLUMN "value";

-- AlterTable
ALTER TABLE "Factor" DROP COLUMN "key",
ADD COLUMN     "category" "FactorCategory" NOT NULL;

-- DropEnum
DROP TYPE "FactorValue";
