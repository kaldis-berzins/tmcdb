# Changes to the Koton time period search

## 1. Define what no prior rights means

**Priority: P1. Files: `src/lib/server/db-schema-prompt.ts`, `src/routes/api/chat/+server.ts`, and the factor extraction and verification logic.**

Do not substitute factor D3, “3rd party not required,” for a factual finding that no prior rights existed. D3 is a doctrinal classification. A decision can discuss that principle while involving parties with earlier rights.

Support two distinct searches:

- **Factual absence:** decisions where the relevant party lacked the specified earlier rights. Verify this from the decision, including the relevant date, territory, and goods or services where material. An unmentioned right is not proof that no right existed.
- **Doctrinal proposition:** decisions citing Koton for the proposition that earlier rights are not required. Verify that the citation supports the proposition, rather than merely appearing elsewhere in the document.

Clarify the intended meaning when it changes inclusion. Do not treat absence of prior use, absence of registration, absence of a third party, and absence of earlier rights as interchangeable conditions.

Koton itself involved earlier KOTON registrations. Its doctrinal conclusions do not establish that later decisions citing it concern parties with no earlier rights. See the [official case summary](https://eur-lex.europa.eu/legal-content/EN/SUM/?uri=CELEX%3A62018CJ0104_RES).

Use D3 to retrieve candidates, then verify the requested condition. Preserve factual findings separately from doctrinal tags; do not redefine D3 to serve both purposes. A verification step can be introduced before deciding whether persistent fields require a schema migration.

## 2. Restrict the institutions being counted

**Priority: P1. Files: analytical query generation or service and `src/routes/api/chat/+server.ts`.**

The current aggregates have no institution filter. The displayed examples include Board of Appeal decisions, so the results do not establish the peak for Cancellation Division decisions alone.

- For **Cancellation Division decisions**, apply `d."institution" = 'CD'` consistently to counts, examples, and coverage checks.
- For **all decisions arising from cancellation proceedings**, include the intended appeal stages explicitly, verify proceeding scope, and identify that broader population in the answer.
- Provide an institution breakdown when several stages are included. Keep distinct decisions at different stages distinct unless the user asks to count disputes instead.
- Do not add a `CANCELLED` outcome requirement automatically. A rejected cancellation application still produces a decision in cancellation proceedings; this question does not require a successful bad-faith claim.

## 3. Identify citations to the specific Koton judgment

**Priority: P1. Files: `scripts/populate_citations.ts`, citation retrieval logic, and `src/lib/server/db-schema-prompt.ts`.**

Replace `%104/18%` and unrestricted `%Koton%` matching as the final inclusion test. They omit parts of the case identity or match text that merely contains the name.

- Resolve the target to **C-104/18 P, 12 September 2019, EU:C:2019:724**.
- Reuse and test the existing reference normalization logic for hyphens, spaces, and other supported formatting variants.
- Match verified resolved targets and complete normalized unresolved references. If a reference omits the appeal suffix, use supporting context to confirm it rather than dropping meaningful parts of every identifier.
- Distinguish the judgment from the Advocate General opinion and earlier decisions in the same litigation when the citation supplies enough information. Flag unresolved document ambiguity.
- Treat name-only matches as candidates requiring inspection.
- Do not interpret other authorities sharing a passage with Koton as alternative Koton identities. The initial reference table contains such entries.

## 4. Verify one population and reuse it for every query

**Priority: P1. Files: proposed analytical search service and `src/routes/api/chat/+server.ts`.**

The current query intersects “mentions Koton somewhere” with “has D3 somewhere.” It retrieves no evidence for D3 and establishes no connection between the cited judgment and the requested proposition or facts.

Build one qualifying-decision set using the chosen interpretation, institution scope, citation verification, and decision identity rules. Reuse that set for annual counts, quarterly counts, and examples.

For each qualifying decision, retain:

- The citation passage identifying Koton.
- The passage establishing the requested factual absence or doctrinal proposition.
- Paragraph numbers or source offsets, verification status, and any unresolved qualification.

The BRUSHMO follow-up query does not validate the aggregates: it omits D3, uses a different text condition, and returns one decision twice. Its passage concerns absence of prior use. Replace that check with evidence retrieval from the actual qualifying set.

When explaining the quarterly peak, retrieve examples from that quarter. The current final examples all come from Q4 of the peak year and do not substantiate the Q3 maximum.

## 5. Count canonical decisions

**Priority: P1. Files: import identity handling, analytical search service, and aggregation.**

`COUNT(DISTINCT d.id)` prevents repeated citations from multiplying a database record. It does not remove multiple imported records representing one legal decision.

- Apply the canonical document identity rules recommended in the other reviews before aggregation, using ECLI or verified court, case number, date, document type, and source information.
- Preserve trademark associations and source keys under that identity. Do not count an additional judgment solely because it has another imported association.
- Do not blindly merge every record sharing a case number or every decision in an appeal chain.
- Reconcile conflicting dates before assigning a canonical decision to a time bucket; retain the authoritative source for the chosen issue date.
- Until identity reconciliation is complete, report **matching database records** rather than distinct legal decisions.

The reported annual lead is only three records: 33 in 2025 versus 30 in 2024. Duplicate or classification corrections could change the ranking, but that has not been verified for this result set.

## 6. Define periods and handle ties

**Priority: P2. Files: aggregation queries and final-response formatting.**

- State whether the analysis uses calendar years, calendar quarters, or a specified rolling window. Do not describe a calendar-quarter maximum as the maximum over every possible interval.
- Derive quarter boundaries from `DATE_TRUNC('quarter', d."date")`. For 2025 Q3, use the half-open interval `date >= DATE '2025-07-01' AND date < DATE '2025-10-01'`.
- Report Q3 as **1 July–30 September 2025**. Label 2 July and 29 September only as the first and last matching decision dates observed within that quarter.
- Return all periods tied for the maximum, using a maximum-count comparison or rank by count alone. A secondary date ordering must not silently choose one winner.
- Compute maxima over the entire qualifying population before limiting displayed results. Top-20 output can be a presentation choice; it must not truncate the data being aggregated or hide tied winners.

## 7. Report coverage and excluded records

**Priority: P2. Files: analytical search service and final-response formatting.**

- Report the database coverage cutoff and whether the compared years or quarters are complete. The local source exports extend into May 2026; this is not a verified live-database coverage date.
- Mark 2026 as incomplete where appropriate. Label comparisons of full periods separately from partial-period counts.
- Report records excluded for missing dates and candidates awaiting citation or factor processing. Missing metadata can affect temporal comparisons.
- Distinguish decisions with no qualifying evidence from decisions whose text or extraction is unavailable.
- Describe the result as a peak **within the verified indexed population**. Do not generalize it to all EUIPO decisions without establishing corpus coverage.

The corrected winner and counts require a new query against the live database. Keep the existing 33-record annual maximum and 16-record quarterly maximum labelled as results of the original proxy filters.

## Implementation order

1. Separate the factual and doctrinal interpretations and specify institution scope.
2. Verify the Koton target and build one evidence-backed qualifying set.
3. Reconcile decision identity and dates, then regenerate annual and quarterly aggregates.
4. Add period boundaries, tie handling, coverage metadata, and examples from the winning period.
5. Update the prompt and result contract so the final explanation cannot overstate the verified scope.

## Acceptance checks

| Scenario | Expected behavior |
| --- | --- |
| Decision states prior rights are unnecessary but the party has earlier rights | May qualify for the doctrinal search; does not automatically qualify for factual absence |
| Decision states there was no prior use | Does not automatically become a finding of no prior rights |
| Koton citation and D3 occur in unrelated passages | Requires further verification for the doctrinal search |
| Query asks for Cancellation Division decisions | BOA, GC, and ECJ records do not enter the count |
| Cancellation application was rejected | Remains eligible if the requested citation and factual or doctrinal conditions are satisfied |
| Reference contains 104/18 with another court prefix | Does not qualify solely through substring matching |
| Supported spelling or spacing variant of C-104/18 P | Matches after normalization and target verification |
| Multiple citations or imported associations for one judgment | One canonical decision per time bucket |
| Two years or quarters share the maximum | All tied periods are reported |
| Qualifying decisions on 30 June, 1 July, 30 September, and 1 October | Only 1 July and 30 September fall in Q3 |
| A period contains no match at its calendar boundary | Its reported start and end remain calendar boundaries |
| Some records have missing dates or incomplete processing | Their exclusion or uncertainty is visible in coverage metadata |
| Quarterly and annual totals use the same population | All four quarters sum to the annual count |
| Examples accompany a quarterly maximum | They come from that qualifying quarter and include the relevant evidence |

After implementation, run `npm run check`, relevant citation and aggregation tests, and the original question through the web interface. Compare the strict CD-only result with the explicitly broader proceedings result, and verify examples against the source decisions. Do not assume that the original winning period will remain the winner.
