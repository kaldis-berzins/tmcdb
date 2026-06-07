SELECT
  d.id,
  d."sourceKey",
  d."caseNumber",
  d.date,
  d."decisionType",
  d.outcome,
  d."badFaithOutcome",
  d."trademarkNumber",
  d."trademarkName",
  df.evidence
FROM "Decision" d
JOIN "DecisionFactor" df
  ON df."decisionId" = d.id
JOIN "Factor" f
  ON f.id = df."factorId"
WHERE f.id = 'D7'
  -- optional, if your database contains non-EUIPO sources:
  AND d.source = 'EUIPO'
ORDER BY d.date DESC NULLS LAST, d."caseNumber";