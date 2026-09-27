-- Change the seed case number to inspect a different appeal chain.
-- Traverse APPEAL only: shared citations and RELATED edges do not establish an appeal.
WITH RECURSIVE chain AS (
  SELECT d."id", ARRAY[d."id"]::text[] AS visited
  FROM "Decision" d
  WHERE d."caseNumber" = 'C-104/18 P'
    AND d."source" = 'MANUAL'

  UNION ALL

  SELECT next_decision."id", chain.visited || next_decision."id"
  FROM chain
  JOIN "DecisionLink" link
    ON link."linkType" = 'APPEAL'
   AND (link."fromDecisionId" = chain."id" OR link."toDecisionId" = chain."id")
  JOIN "Decision" next_decision
    ON next_decision."id" = CASE
      WHEN link."fromDecisionId" = chain."id" THEN link."toDecisionId"
      ELSE link."fromDecisionId"
    END
  WHERE NOT next_decision."id" = ANY(chain.visited)
)
SELECT DISTINCT
  d."id", d."caseNumber", d."institution", d."date", d."outcome",
  d."badFaithOutcome", d."url" AS "decisionUrl",
  lower_decision."caseNumber" AS "challengedCaseNumber",
  unresolved."externalReference" AS "unresolvedChallengedDecision"
FROM chain
JOIN "Decision" d ON d."id" = chain."id"
LEFT JOIN "DecisionLink" outgoing
  ON outgoing."fromDecisionId" = d."id" AND outgoing."linkType" = 'APPEAL'
LEFT JOIN "Decision" lower_decision ON lower_decision."id" = outgoing."toDecisionId"
LEFT JOIN "DecisionLink" unresolved
  ON unresolved."id" = outgoing."id" AND unresolved."toDecisionId" IS NULL
ORDER BY d."date" ASC NULLS LAST, d."caseNumber";
