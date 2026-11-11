# Citation search implementation and validation

Implemented and checked on 11 November 2026 against the configured database. This records the implementation of `citation-search-issues.md`; it does not claim coverage of all EUIPO case law.

## Behavior

- `resolveCase` uses a source-backed, extensible authority registry. Its seed entries cover Raimund v Aigner, Brauwelt, CeramTec, Koton and Lindt. An ambiguous Raimund request requires selection. Other complete case numbers and ECLIs work without an imported target decision; unknown names require an identifier.
- `findCitingDecisions` uses parameterized queries and the same parser as ingestion. SQL regexes only select candidates; exact parsed references establish matches. The cited decision's text is never used to establish citation direction.
- Case numbers preserve meaningful suffixes. Supported Unicode hyphens, spaces, soft hyphens and line breaks normalize consistently. Extraction also recognizes ECLIs and Board of Appeal references.
- Document-level verification requires the selected ECLI or an associated date without conflicting ECLI/type evidence. Docket-only mentions remain a separate candidate category. Known self-references are excluded; an identified opinion in the same docket can remain a citation.
- Results deduplicate by `Decision.id`. Evidence passages contain the matching identifier, retain offsets where available, and preserve source keys when URLs are absent. Evidence counts are passage counts, not literal occurrence counts.
- Pagination uses signed, target-bound keyset cursors. One page scans at most 300 candidate decisions within an eight-second application budget, with a maximum page size of 100. A further verified/candidate result or an exhausted scan budget produces continuation. Exact totals are available after the terminal page.
- Execution completion, pagination and corpus coverage are separate. Both indexed citations and the citing document's text are checked. A missing text or successful extraction flag never proves universal coverage.
- SQL uses a 10-second statement timeout inside a 15-second transaction, configurable through `SQL_STATEMENT_TIMEOUT_MS` and `SQL_TRANSACTION_TIMEOUT_MS`. The transaction budget is always at least five seconds greater. Database read-only execution and row caps remain enforced; generic SQL reports truncation and unknown completeness.
- Chat recovery preserves authority and cursor, bounds repeated attempts, and reserves the eighth model step for tools-disabled finalization. Structured result/status messages and a deterministic fallback survive generation failures. Explicitly stopping a response also leaves a visible incomplete-status notice.
- Exploratory SQL tables are collapsed. Citation results show the authority, verified decisions, uncertain mentions, evidence and continuation controls together.

## Stored-data repair

The read-only audit covered 2,541 decisions. One lacks text; none have `citationsProcessed = false`.

The reviewed repair was applied to 2,210 decisions:

| Change | Count |
| --- | ---: |
| Existing links updated | 3,638 |
| Links detached because identity was unsupported or contradicted | 2,210 |
| Previously unresolved links resolved | 1,428 |
| Added ECLI references | 21,288 |
| Added other previously unrepresented references | 130 |

A major confirmed issue was passages citing Lindt's Advocate General opinion being linked to the judgment. Conflicting dates, ECLIs and document types now prevent that association. Existing citation passages were preserved. The repair adds references missing from a decision's citation set; it does not rebuild every occurrence or change decision metadata.

The local audit contains old link values and proposed additions in `.cache/citation-audit/audit-2026-11-11.json`; its `.applied.json` companion records the completed decisions. Each decision's repair checks its text and citation snapshot and commits atomically. A subsequent full audit proposed **zero updates and zero additions**.

No Prisma schema or index migration was performed.

## Validation

- All 53 parser, retrieval, audit, chat, importer, enrichment, serialization and Markdown tests passed.
- `npm run check` passed with zero errors and warnings; `npm run build` passed.
- A six-second SQL query completed. An eleven-second sleep hit the ten-second statement timeout. A database-level write attempt was rejected, and the SQL row-cap probe exposed truncation.
- Fixture pagination traversed 503 expected decisions without omissions or duplicates.
- Live pagination traversed every page for Koton and Lindt without duplicate decision IDs; terminal totals matched the collected distinct records.
- Browser checks verified Raimund disambiguation and the selected Raimund and CeramTec searches reaching final explanations with explicit coverage limitations. A nonempty Koton result displayed matching evidence, and Continue search appended a further page while retaining the selected authority.
- Mock model tests verified a tools-disabled final step, fallback text after an empty final generation, stream-error finalization prevention of silent Raimund selection, and rejection of model-invented identifiers for unknown names.
- The browser check exposed an unrelated obsolete `%svelte.favicon%` placeholder causing a Vite error overlay; that invalid favicon link was removed.

## Live search measurements

Counts below are database decision records, not deduplicated real-world judgments. Different imported documents or trademark records can share a docket.

| Authority | Verified records | Docket-only candidates | Pages of 25 | Complete traversal |
| --- | ---: | ---: | ---: | ---: |
| Raimund v Aigner | 0 | 0 | 1 | 1.13 s |
| Brauwelt | 1 | 0 | 1 | 1.03 s |
| CeramTec | 0 | 0 | 1 | 0.98 s |
| Koton | 537 | 3 | 22 | 15.32 s |
| Lindt | 1,922 | 37 | 79 | 51.22 s |

`EXPLAIN (ANALYZE, BUFFERS)` measured initial candidate queries at approximately 80–601 ms after repair. Corresponding pre-repair measurements for Raimund, Brauwelt, CeramTec and Koton were approximately 55–546 ms. These are individual local measurements, not a performance improvement claim. Plans and result metadata are saved locally under `.cache/citation-audit/search-verification*.json`.

No index migration is justified by these initial page timings. Retrieving very large result sets still costs time; pagination makes that visible and bounded. A persisted canonical-reference index and richer authority/document metadata remain follow-up options if the corpus or workload grows.

## Operational limits

- The alias registry is intentionally small; an unknown party name is not guessed from full-text fragments.
- The parser covers explicit supported identifiers. Abbreviated joined-case lists, OCR corruption and name-only citations can remain undiscovered.
- For an unknown ECLI without docket metadata, self-citations cannot always be excluded; the result includes that limitation.
- Document dates are associated conservatively with preceding local citation context. Uncertain evidence remains separate.
- Cursors expire after 30 minutes or a server-process restart and are local to one process. Restart the search after a corpus change; concurrent edits are not a frozen snapshot. A shared signing secret/snapshot mechanism would be needed for multiple application workers.
- Stored metadata still lacks dedicated titles, aliases and ECLI fields. Raw citation references are preserved, with canonicalization performed by the shared parser.
