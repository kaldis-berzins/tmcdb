# Changes to the prior relationship and bad faith search

## 1. Verify bad faith separately from cancellation scope

**Priority: P1. Files: `scripts/fix_outcome.ts`, `src/routes/api/chat/+server.ts`, `src/lib/server/db-schema-prompt.ts`.**

Replace the assumption that `badFaithOutcome IN ('CANCELLED', 'PARTIAL')` establishes an adjudicated finding of bad faith. The outcome script maps general cancellation results to these values and also infers results from headers and linked decisions.

- Treat the existing outcome filter as a way to retrieve candidates until the classifications have been audited.
- Record separately whether bad faith was found, rejected, not decided, or remains uncertain; whether that finding was made or upheld by the current authority; and whether invalidity was full or partial.
- Require a supporting passage and source location for the bad-faith finding. An invalidity result, a mention of the relevant provision, or the phrase “bad faith” in a heading is insufficient on its own.
- Do not copy a linked decision's outcome into an appeal record without checking what the appeal actually decided. Preserve procedural dispositions separately.
- Do not infer rejection of bad faith merely because the final cancellation outcome is unknown or the matter was remitted.
- Correct the CorrosionX records as a regression case. T-1127/23 appears as both `CANCELLED` and `PARTIAL`; the judgment concerns partial invalidity for specified Class 2 goods and upholds the bad-faith finding. See paragraphs 2–7 and 78 of the [judgment](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A62023TJ1127).

Until verification is implemented, replace “445 fully cancelled for bad faith” with wording that accurately describes the stored codes and their provisional status.

## 2. Verify the relationship facts behind R2 and R3

**Priority: P1. Files: `scripts/populate_decision_factors.ts`, the extraction prompt referenced by `OPENAI_PROMPT_ID`, and the proposed relationship search service.**

R2 and R3 identify broad candidate categories. They do not establish all the facts requested by the user. Extend extraction or add a verification pass that returns:

- Relationship type, such as distribution, agency, licensing, employment, management, partnership, or joint venture.
- The participants and their connection to the parties in the decision, including companies acting through individuals or related entities.
- Whether the relationship is direct or indirect.
- Whether it was accepted as fact, merely alleged, disputed without resolution, or mentioned as a general possibility.
- Timing relative to the contested filing, with the supporting dates or passage. Distinguish a relationship that ended before filing from one that existed before and continued through filing.
- Supporting text and its paragraph or source offsets.

Use `unknown` where the evidence does not establish an attribute. Do not force every candidate into a confirmed category.

Audit the following examples from the output:

| Example | Required correction or verification |
| --- | --- |
| Brasil Sul | The snippet reports the applicant's allegation of a distributorship. Locate the authority's finding before treating it as established. |
| SHERPA and SHERPA GRAPH | Separate preliminary negotiations from an established commercial arrangement. |
| PROPOSEPT | Label the indirect connection through another distributor; do not describe it as a direct distributorship between the parties. |
| ARSENIE | Establish who the licensee was, its connection to the opposing party, and whether the licence preceded the contested filing. |

These snippets are insufficient evidence; they do not prove that the underlying decisions must be excluded.

The extraction validator currently checks tag IDs, categories, and nonempty evidence. Add checks that evidence can be located in the source, with a defined allowance for whitespace and translation differences. Semantic validation must also distinguish a party's submissions from the authority's findings. Version the extraction prompt so a later audit can reproduce the classification.

Do not require proof that the relationship caused the bad-faith finding unless the user asks that narrower question. This request concerns a bad-faith finding in a case where the relationship existed. A relationship marked “not relied on” may therefore still be relevant if its existence is established.

## 3. Count legal decisions rather than imported records

**Priority: P1. Files: `scripts/import.ts`, the proposed relationship search service, and result aggregation.**

`COUNT(DISTINCT d.id)` and grouping by `d.id` remove repeated factor matches but retain multiple imported records for the same legal decision. The displayed 75 records contain only 67 distinct court, case-number, and date combinations. CorrosionX has conflicting outcome codes across its two records.

- Audit the repeated groups before merging anything. A shared court, case number, and date is a duplicate-detection signal, not a sufficient universal identity rule.
- Establish a canonical document identity using ECLI where available, or verified court, case number, date, document type, and source-document information.
- Preserve trademark-specific associations and all source keys under the canonical decision. Multiple trademark associations should not automatically become multiple judgments in a decision count.
- Keep separate decisions at different appeal stages separate. Do not merge every document within a dispute into one result.
- Flag conflicting outcomes and evidence for reconciliation. Do not silently keep whichever record appears first.
- Use the same canonical identity in result lists, totals, and pagination.

Until this is complete, label the total as **matching database records**, not distinct decisions. Do not present 67 as a verified unique-judgment count; it is the number of distinct court/case/date combinations in the displayed sample.

## 4. Expand candidate retrieval for licensing and employment

**Priority: P2. Files: relationship search service and `src/lib/server/db-schema-prompt.ts`.**

The search should explicitly cover the relationship types in the request rather than rely exclusively on `R2` and `R3`.

- Retrieve R2/R3 candidates, then supplement them with targeted searches of factor evidence and decision text for licensing, employment, management, distribution, agency, and partnership references.
- Support the languages present in the corpus. English-only substring searches will miss some of the multilingual evidence visible in this output.
- Apply the relationship and outcome verification steps to supplemental matches; keywords alone must not qualify a decision.
- Check missing texts and unprocessed factors before making statements about coverage. Use `factorsProcessed` as processing metadata, not as proof that the extracted tags are correct.
- For an examples request, prioritize well-supported matches across the requested relationship types. Use recency as a secondary ordering criterion rather than filling the list entirely with the newest broad matches.

## 5. Separate candidate selection from final inclusion

**Priority: P1. Files: proposed relationship search service and `src/routes/api/chat/+server.ts`.**

Implement the search as explicit stages:

1. Retrieve candidate record IDs through factor and text searches. Use `EXISTS` or a distinct-ID set so multiple factors do not multiply candidates.
2. Resolve records to canonical decision identities and flag conflicting data.
3. Verify the bad-faith finding, relationship participants, factual status, and timing from source passages.
4. Classify each decision as verified, needing review, or excluded, with reasons.
5. Count and paginate the selected result class, then produce the final explanation.

For the main verified list, require both a supported bad-faith finding and an established relationship matching the requested scope. Put negotiations, indirect connections, and uncertain timing in clearly labelled additional results where useful.

Use one inclusion predicate for the verified list and its count. Keep the candidate-record count separate. Verifying only the displayed page does not establish a verified total for the entire candidate set.

Add a stable identity tie-breaker to the current `ORDER BY date DESC NULLS LAST, caseNumber` before pagination. Retain an explicit display limit and provide continuation when requested.

## 6. Return evidence that supports the answer

**Priority: P2. Files: `src/routes/+page.svelte`, `src/lib/components/SQLResultTable.svelte`, and the search result contract.**

- Return relationship evidence and bad-faith finding evidence separately, each with a paragraph or source location.
- Replace the two independent `STRING_AGG` values with structured evidence entries that keep each factor, relationship type, passage, and verification status together.
- Avoid truncating a passage before its qualification or conclusion. The current `LEFT(df.evidence, 350)` can remove context needed for verification. Expandable evidence should retrieve the complete relevant passage.
- Display the specific relationship type instead of only the broad R2/R3 label.
- Distinguish candidate records, verified decisions, and examples actually reviewed in captions and prose.
- Label full versus partial invalidity only after checking the operative scope. Do not describe success on every challenged good as cancellation of the entire registration without verification.
- Repair missing decision URLs from verified source metadata where available. Keep a copyable source identifier when no link is available; do not claim URLs are provided when the cells are blank.

## Implementation sequence

1. Change the prompt and result labels immediately so unverified tags and outcome codes are not presented as established findings.
2. Add source verification for shortlisted examples and reconcile the CorrosionX records.
3. Implement canonical decision grouping and a shared list/count predicate.
4. Improve extraction for relationship type, participants, factual status, timing, and evidence locations; supplement retrieval for licensing and employment.
5. Persist verified classifications and provenance if needed for repeatable full-corpus queries. Scope any schema migration separately and preserve existing source records and manual annotations.

## Acceptance checks

| Fixture or scenario | Expected result |
| --- | --- |
| Cancellation on another ground, with bad faith rejected or unexamined | Excluded from the verified bad-faith list |
| CorrosionX T-1127/23 | One canonical judgment with a supported bad-faith finding and partial invalidity scope; source records retained |
| One decision carrying both R2 and R3 | One candidate decision with both evidence entries |
| Multiple source records or trademark associations for one judgment | One legal-decision count after identity verification; associations preserved |
| Separate cancellation and appeal decisions | Remain distinct documents with their respective findings |
| Relationship only alleged | Marked for review unless the authority's acceptance is found |
| Negotiations or indirect connection | Clearly distinguished from an established direct arrangement |
| Relationship with an unrelated third party | Does not qualify as a relationship between the relevant parties |
| Relationship created only after the contested filing | Does not qualify as a prior relationship for this search |
| Accepted relationship not relied on in the reasoning | Can qualify if bad faith was found; no invented causal claim |
| Licensing or employment case without R2/R3 | Can be found through supplemental retrieval and verified |
| Some candidates remain unreviewed | Candidate total and verified-example count are reported separately |
| Truncated or multilingual evidence | Full source passage remains available and preserves qualifications |

After implementation, run `npm run check`, relevant extraction and search tests, and the original question through the web interface. Check each highlighted example against the source decision. Recompute totals only after the inclusion rules and decision identity rules are applied consistently; the live corrected total is currently unverified.
