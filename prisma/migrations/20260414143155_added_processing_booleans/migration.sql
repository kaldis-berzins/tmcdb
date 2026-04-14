-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "citationsProcessed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "factorsProcessed" BOOLEAN NOT NULL DEFAULT false;
