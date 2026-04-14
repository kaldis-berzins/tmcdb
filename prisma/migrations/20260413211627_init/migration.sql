/*
  Warnings:

  - You are about to drop the `Post` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "DecisionSource" AS ENUM ('EUIPO', 'GC', 'CJEU', 'OTHER');

-- CreateEnum
CREATE TYPE "LinkType" AS ENUM ('APPEAL', 'RELATED');

-- CreateEnum
CREATE TYPE "FactorValue" AS ENUM ('YES', 'NO', 'UNCLEAR', 'NOT_ADDRESSED');

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_authorId_fkey";

-- DropTable
DROP TABLE "Post";

-- DropTable
DROP TABLE "User";

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT,
    "source" "DecisionSource" NOT NULL,
    "caseNumber" TEXT,
    "date" TIMESTAMP(3),
    "title" TEXT,
    "url" TEXT,
    "decisionType" TEXT,
    "outcome" TEXT,
    "trademarkNumber" TEXT,
    "trademarkName" TEXT,
    "textLanguage" TEXT,
    "textUrl" TEXT,
    "text" TEXT,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provision" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "article" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Provision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionProvision" (
    "decisionId" TEXT NOT NULL,
    "provisionId" TEXT NOT NULL,

    CONSTRAINT "DecisionProvision_pkey" PRIMARY KEY ("decisionId","provisionId")
);

-- CreateTable
CREATE TABLE "Factor" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionFactor" (
    "decisionId" TEXT NOT NULL,
    "factorId" TEXT NOT NULL,
    "value" "FactorValue" NOT NULL,
    "evidence" TEXT,

    CONSTRAINT "DecisionFactor_pkey" PRIMARY KEY ("decisionId","factorId")
);

-- CreateTable
CREATE TABLE "DecisionLink" (
    "id" TEXT NOT NULL,
    "fromDecisionId" TEXT NOT NULL,
    "toDecisionId" TEXT,
    "externalReference" TEXT,
    "linkType" "LinkType" NOT NULL,

    CONSTRAINT "DecisionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "citingDecisionId" TEXT NOT NULL,
    "citedDecisionId" TEXT,
    "citedReference" TEXT,
    "text" TEXT NOT NULL,

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Decision_sourceKey_key" ON "Decision"("sourceKey");

-- CreateIndex
CREATE INDEX "Decision_caseNumber_idx" ON "Decision"("caseNumber");

-- CreateIndex
CREATE INDEX "Decision_date_idx" ON "Decision"("date");

-- CreateIndex
CREATE INDEX "Decision_trademarkNumber_idx" ON "Decision"("trademarkNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Provision_label_key" ON "Provision"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Provision_code_article_key" ON "Provision"("code", "article");

-- CreateIndex
CREATE INDEX "DecisionProvision_provisionId_idx" ON "DecisionProvision"("provisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Factor_key_key" ON "Factor"("key");

-- CreateIndex
CREATE INDEX "DecisionFactor_factorId_value_idx" ON "DecisionFactor"("factorId", "value");

-- CreateIndex
CREATE INDEX "DecisionLink_fromDecisionId_linkType_idx" ON "DecisionLink"("fromDecisionId", "linkType");

-- CreateIndex
CREATE INDEX "DecisionLink_toDecisionId_linkType_idx" ON "DecisionLink"("toDecisionId", "linkType");

-- CreateIndex
CREATE INDEX "Citation_citingDecisionId_idx" ON "Citation"("citingDecisionId");

-- CreateIndex
CREATE INDEX "Citation_citedDecisionId_idx" ON "Citation"("citedDecisionId");

-- AddForeignKey
ALTER TABLE "DecisionProvision" ADD CONSTRAINT "DecisionProvision_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionProvision" ADD CONSTRAINT "DecisionProvision_provisionId_fkey" FOREIGN KEY ("provisionId") REFERENCES "Provision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionFactor" ADD CONSTRAINT "DecisionFactor_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionFactor" ADD CONSTRAINT "DecisionFactor_factorId_fkey" FOREIGN KEY ("factorId") REFERENCES "Factor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLink" ADD CONSTRAINT "DecisionLink_fromDecisionId_fkey" FOREIGN KEY ("fromDecisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLink" ADD CONSTRAINT "DecisionLink_toDecisionId_fkey" FOREIGN KEY ("toDecisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_citingDecisionId_fkey" FOREIGN KEY ("citingDecisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_citedDecisionId_fkey" FOREIGN KEY ("citedDecisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
