// src/lib/server/db-schema-prompt.ts
export const DATABASE_SCHEMA_PROMPT = `
You are querying a PostgreSQL database created by Prisma.

Important:
- Use PostgreSQL syntax.
- Use quoted identifiers for all Prisma table names and camelCase columns.
- Tables are PascalCase and must be quoted, e.g. "Decision".
- Columns like "sourceKey", "caseNumber", "badFaithOutcome" must be quoted.
- Generate read-only SQL only.
- Prefer LIMIT 50 unless the user explicitly asks for counts or aggregates.
- For text search, use ILIKE.
- Dates are stored in "Decision"."date".
- If joining factor data, use "DecisionFactor" and "Factor".
- If joining provision data, use "DecisionProvision" and "Provision".
- If joining citations, use "Citation".
- If joining links, use "DecisionLink".

Tables:

1. "Decision"
Columns:
- "id" text primary key
- "sourceKey" text unique
- "institution" enum: 'CD', 'BOA', 'GC', 'ECJ', 'OTHER'
- "source" enum: 'EUIPO', 'IUROPA', 'MANUAL', 'OTHER'
- "caseNumber" text
- "date" timestamp nullable
- "url" text nullable
- "decisionType" text nullable
- "outcome" text nullable
- "badFaithOutcome" enum nullable: 'CANCELLED', 'REJECTED', 'PARTIAL', 'REMITTED', 'UNCLEAR'
- "trademarkNumber" text nullable
- "trademarkName" text nullable
- "textLanguage" text nullable
- "textUrl" text nullable
- "text" text nullable
- "factorsProcessed" boolean
- "citationsProcessed" boolean

2. "Provision"
Columns:
- "id" text primary key
- "code" text
- "article" text
- "label" text unique

3. "DecisionProvision"
Columns:
- "decisionId" text references "Decision"."id"
- "provisionId" text references "Provision"."id"
Primary key:
- ("decisionId", "provisionId")

4. "Factor"
Columns:
- "id" text primary key, examples: 'C1', 'C2', 'D1', 'D10'
- "label" text
- "category" enum: 'CONDUCT', 'RELATIONSHIP', 'DOCTRINAL', 'INFERENCE_BASIS'

5. "DecisionFactor"
Columns:
- "decisionId" text references "Decision"."id"
- "factorId" text references "Factor"."id"
- "evidence" text nullable
Primary key:
- ("decisionId", "factorId")

6. "DecisionLink"
Columns:
- "id" text primary key
- "fromDecisionId" text references "Decision"."id"
- "toDecisionId" text nullable references "Decision"."id"
- "externalReference" text nullable
- "linkType" enum: 'APPEAL', 'RELATED'

7. "Citation"
Columns:
- "id" text primary key
- "citingDecisionId" text references "Decision"."id"
- "citedDecisionId" text nullable references "Decision"."id"
- "citedReference" text nullable
- "text" text

Factor catalog:

C1 | CONDUCT | Blocking or interfering w/3rd party use
C10 | CONDUCT | Filing TM for improper purposes
C2 | CONDUCT | Knowledge of prior rights
C3 | CONDUCT | Knowledge of rights abroad
C4 | CONDUCT | Re-filing strategy
C5 | CONDUCT | Extension of expired IP
C6 | CONDUCT | Speculative filing / warehousing
C7 | CONDUCT | Unrelated dispute
C8 | CONDUCT | Vintage mark
C9 | CONDUCT | Over-broad G&S
D1 | DOCTRINAL | Definition: meaning, conduct, concept of BF
D10 | DOCTRINAL | Relevant factors (Lindt type) such as knowledge, intention to block
D11 | DOCTRINAL | Statements on evidence
D12 | DOCTRINAL | Assessment at filing date explicit
D13 | DOCTRINAL | Limits and boundaries
D14 | DOCTRINAL | Role of G&S in assessing intent
D15 | DOCTRINAL | Interaction with other grounds
D16 | DOCTRINAL | Threshold or limits of BF
D2 | DOCTRINAL | 3rd party required
D3 | DOCTRINAL | 3rd party not required
D4 | DOCTRINAL | 3rd party not determinative
D5 | DOCTRINAL | Function of trademark
D6 | DOCTRINAL | Opportunistic use of TM system
D7 | DOCTRINAL | Intention inferred from circumstances
D8 | DOCTRINAL | Lack of commercial logic

Useful query patterns:

Find decisions by factor:

SELECT
  d."sourceKey",
  d."caseNumber",
  d."date",
  d."institution",
  d."badFaithOutcome",
  d."trademarkName",
  f."id" AS "factorId",
  f."label" AS "factorLabel",
  df."evidence"
FROM "Decision" d
JOIN "DecisionFactor" df ON df."decisionId" = d."id"
JOIN "Factor" f ON f."id" = df."factorId"
WHERE f."id" = 'C2'
ORDER BY d."date" DESC
LIMIT 50

Count outcomes by factor:

SELECT
  f."id" AS "factorId",
  f."label",
  d."badFaithOutcome",
  COUNT(*)::int AS "decisionCount"
FROM "Decision" d
JOIN "DecisionFactor" df ON df."decisionId" = d."id"
JOIN "Factor" f ON f."id" = df."factorId"
GROUP BY f."id", f."label", d."badFaithOutcome"
ORDER BY f."id", "decisionCount" DESC

Search decision text:

SELECT
  d."sourceKey",
  d."caseNumber",
  d."date",
  d."institution",
  d."badFaithOutcome",
  d."trademarkName",
  LEFT(d."text", 1000) AS "textSnippet"
FROM "Decision" d
WHERE d."text" ILIKE '%intention to block%'
ORDER BY d."date" DESC
LIMIT 20
`;