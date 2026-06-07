SELECT DISTINCT
  d."id",
  d."sourceKey",
  d."caseNumber",
  d."date",
  d."institution",
  d."source",
  d."decisionType",
  d."badFaithOutcome",
  d."trademarkNumber",
  d."trademarkName",
  d."url",
  df."evidence"
FROM "Decision" d
JOIN "DecisionFactor" df
  ON df."decisionId" = d."id"
JOIN "Factor" f
  ON f."id" = df."factorId"
WHERE f."id" = 'D12'
-- Optional, if you want to restrict expressly to EUIPO decisions:
-- AND d."source" = 'EUIPO'
ORDER BY d."date" DESC NULLS LAST, d."caseNumber";