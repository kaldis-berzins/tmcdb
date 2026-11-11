# Citation search issues and recommended fixes

Implementation completed on 11 November 2026. See [implementation, data repair and validation notes](citation-search-implementation.md). The findings below record the pre-implementation review.

## Evidence and scope

- **Raimund:** the assistant returned one Brauwelt citation, then 310 broadly matched citation rows, encountered a transaction timeout, and concluded that only one decision matched.
- **CeramTec:** the assistant made 10 SQL calls: one timeout, seven empty results, a 72-row broad text search, and a 16-row reference aggregate. The supplied output ends without a final explanation.
- Findings below distinguish defects visible in the transcripts or code from causes that still require verification. Actual matching decision counts, database coverage, and execution plans have not been verified against the live database.
- These were the implementation recommendations at review time. File paths below are relative to the repository root.

## 1. Resolve the case before searching for citations

**Priority:** P1 — correctness. **Status:** confirmed search failure; the intended interpretation of an ambiguous name still needs confirmation.

The Raimund search silently treated a name match for **Raimund Schmitt / Brauwelt, T-56/15** as the requested authority. The likely intended case is **Raimund v Aigner, C-425/16**. The CeramTec search never tried **C-17/24** or its ECLI and instead searched `139/16` and `T-193/14` without establishing their relevance. T-193/14 is the unrelated AERONAUTICA case.

| Name | Verified identity | Use in this review |
| --- | --- | --- |
| Raimund v Aigner | C-425/16; 19 October 2017; EU:C:2017:776 | Likely intended Raimund authority |
| Raimund Schmitt / Brauwelt | T-56/15; 18 October 2016; EU:T:2016:618 | Different case found by the app |
| CeramTec v Coorstek Bioceramics | C-17/24; 19 June 2025; EU:C:2025:455 | CeramTec bad-faith judgment |

**Recommended changes**

- Add a case resolver that returns verified candidates with case number, date, court, title or aliases, ECLI where available, and identity source.
- Resolve a name independently of finding its citing decisions. A cited authority may be absent from the `Decision` table while its citations exist in `Citation`.
- If multiple plausible authorities remain, ask which one is intended. Do not silently treat the first substring match as the answer.
- Permit a small, source-backed alias configuration as the initial implementation. Do not hard-code these two examples as the whole solution.
- Keep the selected authority fixed across retries unless new evidence justifies changing it, and explain any change.

**Files:** `src/routes/api/chat/+server.ts`, `src/lib/server/db-schema-prompt.ts`; proposed case resolver and alias configuration. `Decision` currently has no dedicated case-title, alias, or ECLI fields; `trademarkName` is not a substitute for party names.

## 2. Replace broad wildcard matching with canonical references

**Priority:** P1 — correctness. **Status:** confirmed.

`ILIKE '%T%56%15%'` matches T-456/15 as well as unrelated passages containing those fragments. The Raimund output visibly contains these false matches. CeramTec's `%139%16%` can match numbers in separate references in the same passage. `%ceram%` also matches generic words and marks such as Teploceramic.

**Recommended changes**

- Parse and normalize complete case references, then compare them for equality. Preserve the court prefix, case number, year, and meaningful suffixes such as `P` or `PPU`.
- Normalize supported Unicode hyphens, nonbreaking spaces, soft hyphens, and spacing around separators through one shared implementation.
- For full-text fallback, extract complete references with boundaries before comparing. Do not replace punctuation with unrestricted `%` characters.
- Use broad name fragments only to discover candidates. Validate the identity and citation before including a decision in the answer.
- When identifying a particular judgment, distinguish documents in the same case, such as an Advocate General opinion and the judgment, using date, type, and ECLI when available.

**Files:** `scripts/populate_citations.ts`, proposed shared reference parser, citation search service, and `src/lib/server/db-schema-prompt.ts`.

## 3. Search direct citations rather than indirect mentions

**Priority:** P1 — correctness. **Status:** confirmed defect in the first CeramTec query.

The condition `cited."text" ILIKE '%CeramTec%'` searches the full text of the decision being cited. If A cites B and B mentions CeramTec, this query can return A without evidence that A cites CeramTec.

**Recommended changes**

- Match the selected authority against `Citation.citedDecisionId` or the canonical form of `Citation.citedReference`.
- Do not use the cited decision's full text to establish the identity of the citation target.
- Treat a matching citation passage as evidence to inspect. A passage may contain several authorities, so do not label every citation row sharing that passage as a citation to the requested case.
- If indexed citations are insufficient, search the **citing decision's** text for the verified identifier and extract the matching passage. Keep uncertain name-only mentions separate from verified citations.

**Files:** citation search service, `src/lib/server/db-schema-prompt.ts`, and `src/routes/api/chat/+server.ts`.

## 4. Return distinct decisions and separate citation counts

**Priority:** P1 — correctness. **Status:** confirmed.

The queries use `SELECT DISTINCT` over decision fields **and** citation fields. Different references or snippets therefore produce multiple rows for one decision. The 310 Raimund rows are not 310 distinct decisions. CeramTec's final 16 rows are grouped references, not a list of citing decisions.

**Recommended changes**

- Select decisions using `WHERE EXISTS` with the verified citation predicate, or first collect distinct `citingDecisionId` values.
- Retrieve evidence passages separately or aggregate them under each decision.
- Calculate `COUNT(DISTINCT citingDecisionId)` using exactly the same predicate as the result list. Report mention counts separately.
- Deduplicate by database decision identity initially. Audit repeated case numbers before merging records: different documents or trademark records can legitimately share a case number.

**Files:** citation search service, `src/lib/server/db-schema-prompt.ts`, and `src/lib/components/SQLResultTable.svelte`.

## 5. Align transaction and statement timeouts

**Priority:** P1 — execution. **Status:** confirmed in both transcripts and code.

`src/lib/server/sql.ts:175` opens a Prisma interactive transaction without an explicit timeout. Inside it, PostgreSQL receives a 10-second statement timeout. Prisma's default transaction timeout is 5 seconds. The recorded transactions expired after **8.701 seconds** and **9.522 seconds** respectively.

**Recommended change**

Set the transaction timeout above the statement timeout with overhead allowance. For the current single-query transaction, 15 seconds around a 10-second statement timeout is a reasonable initial setting:

```ts
const rows = await prisma.$transaction(
  async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10s'");
    return tx.$queryRawUnsafe<unknown[]>(wrappedSql);
  },
  { timeout: 15_000 }
);
```

Keep SQL validation, read-only execution, and row limits. Treat the numbers as configurable operational budgets. Optimize slow searches as described below; increasing the timeout does not correct faulty matching.

**Verification:** a controlled query finishing between 5 and 10 seconds commits successfully; a query exceeding the statement budget fails as a timeout; writes remain prohibited.

## 6. Make retries preserve meaning and expose incomplete searches

**Priority:** P1 — correctness. **Status:** confirmed reporting gap; the hidden Raimund retry SQL cannot be assessed.

The API returns only `ok`, rows, or an error string. Its prompt says to correct the SQL and retry on any SQL error. A timeout is not necessarily a SQL syntax problem. Removing a search condition to make a query succeed can change its scope without proving the original search complete.

**Recommended changes**

- Classify failures, including timeout, invalid SQL, connection failure, and validation rejection.
- Use bounded recovery appropriate to the error. For a timeout, prefer an exact identifier query or a smaller page; retain the selected authority and intended coverage.
- Track required search paths, successful checks, unresolved failures, and any change in scope.
- Allow a complete result after a successful equivalent recovery. Otherwise describe the answer as partial and identify the missing check.
- Never interpret a failed query as an empty result, or describe an uncompleted search as successfully performed.

**Files:** `src/lib/server/sql.ts`, `src/routes/api/chat/+server.ts`, and `src/routes/+page.svelte`.

## 7. Report pagination and database coverage explicitly

**Priority:** P1 — completeness. **Status:** confirmed code gap; neither transcript proves that a row cap actually truncated its final result.

The SQL runner caps output at 500 rows and defaults to 100. The schema prompt generally prefers 50. The tool returns `rowCount` but no total, continuation cursor, or truncation flag. A request for “all” can therefore receive a limited list without an explicit completeness signal. Citation and text coverage are also not checked before negative conclusions.

**Recommended changes**

- Add stable pagination and `hasMore` to the dedicated citation search. Fetch one extra row to detect another page; use a unique tie-breaker in the sort order.
- Count matching distinct decisions separately where practical. A single page's length is not the total.
- For “all”, retrieve all pages within an explicit budget or provide continuation/export with a clear partial-result label.
- Do not claim that a generic SQL result is exhaustive merely because it is shorter than the outer cap: its inner query may have its own `LIMIT`.
- Measure missing decision texts, unprocessed citations, and unresolved references. State that results concern the indexed database, not all EUIPO case law.
- Distinguish zero verified matches, unresolved case identity, incomplete corpus coverage, and execution failure.

**Files:** citation search service, `src/lib/server/sql.ts`, `src/routes/api/chat/+server.ts`, `src/routes/+page.svelte`, and `src/lib/server/db-schema-prompt.ts`.

## 8. Guarantee a final response after the search stops

**Priority:** P1 — completion. **Status:** missing final explanation is observed; its runtime cause is unverified.

CeramTec ends with a table of unrelated reference counts. The code uses `stopWhen: stepCountIs(8)`. Budget exhaustion is one possible cause, but 10 SQL calls do not prove it: several calls can occur within one model step. Stream errors, interruption, or an incomplete paste also need checking.

**Recommended changes**

- Log model-step count, tool-call count, finish reason, search status, and stream failures without logging secrets or unnecessary full decision text.
- Reserve a finalization phase after bounded tool execution. Disable further tools for that phase and summarize the verified result state.
- If generation or streaming fails, provide an application-generated fallback showing whether the search completed and which results remain usable.
- Do not rely on raising the step limit as the fix. Repeated broad searches can consume any budget without establishing the target case.

**Files:** `src/routes/api/chat/+server.ts` and `src/routes/+page.svelte`.

## 9. Normalize unresolved citations consistently

**Priority:** P2 — retrieval coverage. **Status:** confirmed code inconsistency; its effect on these result counts is unverified.

The extractor computes `normalizedReference`, but `scripts/populate_citations.ts:250` stores the raw reference when resolution fails. Searches must consequently handle mixed reference formats. Resolution also requires exactly one matching decision, so multiple records for a case remain unresolved.

**Recommended changes**

- Extract the parser and normalizer into a shared module used by ingestion and retrieval.
- Match both resolved IDs and unresolved canonical references. Do not require the cited authority to exist as an imported decision.
- Preserve the original reference and citation passage. If scale requires persisted canonical references, add a separate indexed field through a deliberate migration and backfill.
- Do not resolve multiple candidate documents arbitrarily. Preserve ambiguity and use available document metadata to distinguish them.
- Audit extraction coverage, including Unicode variants, line breaks, and citations expressed only through an ECLI. Extend the parser where verified examples demonstrate gaps.

**Files:** `scripts/populate_citations.ts`; proposed shared parser; `prisma/schema.prisma` only if a separately scoped schema change is justified.

## 10. Show useful evidence and distinguish exploratory results

**Priority:** P2 — usability and reviewability. **Status:** confirmed.

CeramTec's `LEFT(d."text", 800)` snippets mostly show document openings rather than the matching passage. The interface displays broad exploratory tables alongside later results without distinguishing their role. Both examples contain blank decision links; the table also hides `sourceKey`, removing a useful fallback identifier.

**Recommended changes**

- Return a passage centered on the verified match, with paragraph number or source offset where available. Highlight the matching identifier.
- Show one final table of verified citing decisions. Collapse exploratory queries under diagnostics and mark results that were rejected or superseded.
- Use captions that distinguish decisions, citation mentions, candidate matches, and aggregates.
- Show the selected authority and complete/partial/failed search status beside the final result.
- Preserve a copyable source key when a decision URL is absent. Audit missing URLs and backfill only from verified source metadata; do not invent links.
- Update the prompt's blanket `LEFT` guidance so citation queries return relevant evidence rather than document headers.

**Files:** `src/routes/+page.svelte`, `src/lib/components/SQLResultTable.svelte`, `src/routes/api/chat/+server.ts`, and `src/lib/server/db-schema-prompt.ts`.

## 11. Use a dedicated citation workflow and measure query performance

**Priority:** P1 for the workflow; P2 for measured optimization. **Status:** recommended design change; specific performance bottlenecks remain unverified.

Free-form SQL generation currently controls identity resolution, matching, counting, and completeness. Prompt rules alone cannot enforce those invariants. Leading-wildcard scans over long texts and repeated joins are plausible sources of expensive queries, but execution plans are needed to establish the actual bottleneck.

**Recommended workflow**

1. Resolve the requested name or identifier to a verified authority.
2. Search direct indexed citations by resolved IDs and canonical references.
3. Use a bounded full-text fallback when needed; validate matches and retain evidence.
4. Return distinct decisions with a total or pagination status and outstanding coverage limitations.
5. Produce the final explanation from that structured state.

Expose this through dedicated tools such as `resolveCase` and `findCitingDecisions`, backed by parameterized queries. Retain generic `runSql` for other analytical questions. Enforce matching, deduplication, and pagination in application code.

On a representative database, inspect query plans and timings before and after the change. Prefer existing ID indexes and narrow candidate sets before reading long text. Consider an index on a persisted canonical reference, or a text-search index for the remaining fallback, only when measurements justify the migration.

## Implementation order

1. **Fix execution:** align timeouts, classify errors, and ensure every stopped search produces a final status.
2. **Fix correctness:** add case resolution, share reference normalization, and implement direct citation lookup with decision deduplication.
3. **Fix completeness:** add pagination, distinct totals where practical, coverage checks, and structured final-result state.
4. **Fix presentation:** return matching passages and separate verified results from diagnostics.
5. **Improve data and performance:** audit coverage, benchmark queries, then scope any metadata, canonical-reference, or index migrations.

Keep the initial changes targeted. A parser, source-backed alias configuration, dedicated search service, and UI status changes can be introduced without redesigning the database. Persistent alias/ECLI metadata and indexed canonical references are follow-up options when needed.

## Acceptance checks

Use controlled fixtures for retrieval semantics and a representative database for integration and performance checks. Do not invent expected live counts for the two examples.

| Check | Expected behavior |
| --- | --- |
| Ambiguous Raimund name | Present or verify candidates; never silently equate C-425/16 with T-56/15 |
| CeramTec bad-faith authority | Resolve C-17/24 and EU:C:2025:455; never substitute unrelated identifiers |
| Exact reference matching | T-56/15 does not match T-456/15 or numbers spread across a passage |
| Formatting variants | Supported hyphen, whitespace, and line-break variants resolve to the same complete reference |
| Meaningful suffixes | Preserve distinctions such as an appeal suffix; do not merge identifiers blindly |
| Citation direction | A citing B, where only B cites the target, does not make A a direct match |
| Unresolved target | Find exact citations even when the target decision is absent or `citedDecisionId` is null |
| Repeated mentions | Several citations in one decision produce one decision row and a separate mention count |
| More than one page | Expose continuation and partial status; retrieving all pages yields no omissions or duplicates |
| Timeout and recovery | A 5–10 second query completes under the proposed budgets; an over-budget query reports a timeout; recovery preserves scope |
| Missing or unprocessed text | Report the coverage limitation without claiming universal absence |
| Tool budget or stream failure | Produce a final complete, partial, or failed status rather than ending with an unexplained table |
| Evidence display | The visible passage contains the matched identifier, even when it occurs after the document opening |
| Missing decision URL | Keep a usable source identifier visible; no fabricated link |
| Read-only protection | New tools and the existing SQL runner continue to reject writes |

After implementation, run `npm run check`, relevant parser/service tests, database integration checks, and both original questions through the web interface. Review the SQL, verified evidence, final decision count, pagination status, and final explanation together.

## Sources

- [Raimund v Aigner — C-425/16](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62016CJ0425)
- [Raimund Schmitt / Brauwelt — T-56/15](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62015TJ0056)
- [CeramTec — C-17/24](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A62024CJ0017_SUM)
- [AERONAUTICA — T-193/14](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A62014TJ0193)
- [Prisma transaction options and default timeout](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference)
- User-supplied Raimund and CeramTec transcripts and the repository files identified above.
