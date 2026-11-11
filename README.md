## Trademark Cancellation Database
To install:

1. Git Clone the project
2. `npm i`
3. `docker compose up` to start the database
4. `npx prisma migrate dev --name init`
5. `npx prisma generate`

## Common commands

- `npm run dev` starts the SvelteKit dev server
- `npm run build` builds the app
- `npm run check` runs the type and Svelte checks
- `npm run studio` opens Prisma Studio
- `npm run migrate` runs Prisma migrations and regenerates the client

## Data import and processing scripts

- `npm run import:euipo -- <path-to-json>` imports a EUIPO export file, downloads decision text when available, and syncs related-case links for that batch
- `npm run import:manual -- <path-to-csv> --dry-run` previews a manual research CSV import, including duplicate conflicts and omitted columns
- `npm run import:manual -- <path-to-csv>` imports the CSV in one transaction; add `--skip-conflicts` to skip ambiguous database matches
- `npm run enrich:manual -- <path-to-csv>` previews text, citation, factor and appeal enrichment for imported manual cases; add `--apply` to run it
- `npm run link:decisions` backfills `DecisionLink` records across the whole database by resolving saved `externalReference` values to matching `Decision.sourceKey` rows
- `npm run texts:retry-missing -- <case-number> [more-case-numbers...]` retries downloading missing decision text for specific cases; if no case numbers are passed, the script falls back to its built-in defaults
- `npm run outcomes:sync` recalculates `badFaithOutcome` values from decision outcomes and linked appeal decisions
- `npm run outcomes:sync -- --dry-run` previews outcome changes without writing them
- `npm run citations:populate`
  processes decision text into citation rows for decisions whose citations have not yet been processed
- `npm run citations:populate -- --limit 100`
  processes only the next 100 eligible decisions
- `REPROCESS=true npm run citations:populate`
  rebuilds citations even for decisions already marked as processed
- `npm run factors:submit -- --limit 100` submits up to 100 decisions to the OpenAI batch job for factor extraction
- `npm run factors:status -- <batch-id>` checks the status of a factor-extraction batch
- `npm run factors:apply -- <batch-id>` applies a completed factor-extraction batch back into the database
- `npm run factors:run -- --limit 100` submits, waits for, and applies a factor-extraction batch in one step

## Script notes

- The factor extraction script requires `OPENAI_API_KEY` and `OPENAI_PROMPT_ID` in your environment
- The citation and factor scripts support reprocessing through `REPROCESS=true`
- Most script arguments should be passed after `--`, for example `npm run import:euipo -- sources/small-import.json`

### Manual research CSV import

Preview the supplied file:

```bash
npm run import:manual -- "/home/kaldisberzins/Downloads/Cases Manual Search Table-Table1.csv" --dry-run
```

Run the same command without `--dry-run` to write the import. If the report lists ambiguous matches, resolve those records first or add `--skip-conflicts` to import only the unambiguous rows. A conflict blocks the entire import by default and returns exit code 1, including during dry runs. `--validate-only` checks CSV formatting and field mappings without connecting to the database. The script prints a JSON report with proposed values, counts, warnings and conflicts; redirect stdout to save it.

Matching normalizes court case numbers (Unicode hyphens, whitespace, leading zeros and appeal suffix formatting). An existing case keeps its ID and source key, so citations and decision links stay attached. With multiple records for a docket, a unique matching date is required; the importer never deletes or merges existing decision records. A missing `P` suffix requires an equal date. For a single exact case-number match, supplied manual dates can correct the existing date.

Nonblank manual values override existing values and set `source` to `MANUAL`. Blank cells preserve existing data. The EUIPO importer, outcome synchronization and factor extraction scripts preserve manual records, including applying batches submitted before the manual import. Judgment text, text URLs and citation processing status are preserved; this importer does not download judgments or store research summaries as judgment text.

Supported mappings:

| CSV column | Database destination |
| --- | --- |
| Case Number, CJEU/GC, Date | `caseNumber`, `institution` (`CJEU` → `ECJ`, `GC` → `GC`), `date` |
| eSearch/Curia Link, CJEU Procedure Type, Procedural Result | `url`, `decisionType`, `outcome` |
| BF Outcome | `badFaithOutcome`: BF Found → CANCELLED; BF Not Found → REJECTED; Remitted → REMITTED; Partial → PARTIAL; Unclear → UNCLEAR |
| Target Mark(s) | `trademarkName`, preserving the supplied text |
| Link(s) to Mark(s) | `trademarkNumber` when exactly one supported EUIPO trademark link is supplied; leading zeros are preserved |
| Legal Basis, Specific Provision | `Provision` / `DecisionProvision`; a nonblank unambiguous set replaces existing provision associations |
| Conduct Tags, Relationship Tags, Doctrinal Tags, Inference Basis | `Factor` / `DecisionFactor`, replacing findings within each nonblank category |

Factors reuse existing IDs when category and normalized label match. New labels create factors with deterministic `MANUAL_…` IDs; no synonym inference is performed. Existing evidence is retained for tags that remain selected. Empty tag categories preserve their current findings. All four supplied categories mark `factorsProcessed` true.

Multiple trademark numbers cannot fit the single `trademarkNumber` field and are reported as omitted. Multiple legal instruments cannot be reliably paired with the article list, so those provision associations are preserved and the omission is reported. The importer uses existing `CTMR` and `EUTMR` provision codes for the corresponding CSV instruments; other instrument names become their provision codes.

Columns without schema destinations (including ECLI, Short Name, mark types/images, Opinion, procedural winner, Standard of Review, Summary of Proceedings, Importance, Type of Case and Key Holding) are listed in `omittedColumns`. They are not stored. Rows missing both court and date are reported as incomplete and skipped. No schema migration is required.

Run the importer regression tests with `node --import tsx/esm scripts/import_manual.test.ts`.

### Enrich imported manual cases

```bash
npm run enrich:manual -- "/home/kaldisberzins/Downloads/Cases Manual Search Table-Table1.csv"
npm run enrich:manual -- "/home/kaldisberzins/Downloads/Cases Manual Search Table-Table1.csv" --apply
```

The default is a read-only preview. Only existing, unambiguous `MANUAL` decisions matching the CSV are eligible. This command does not reimport metadata or resolve duplicate decision records. `--case "C-104/18 P"` restricts it to one case. Use `--stages texts,citations` or `--stages factors,appeals` to run selected stages.

- **Texts:** downloads English EUR-Lex judgment PDFs or reads supplied HTML judgments using Playwright, checks the document header against the case number, and fills missing judgment text, text URL and language. Existing text is retained. Playwright Chromium must be installed (`npx playwright install chromium`).
- **Citations:** extracts outgoing case references and resolves previously unresolved incoming citations across the database to the imported cases. A citation date can distinguish a judgment from an opinion sharing its docket; genuinely ambiguous matches remain unresolved. Ordinary `citations:populate` runs now also reconsider existing unresolved references.
- **Factors:** uses `OPENAI_API_KEY` and the configured `OPENAI_MODEL` to select numbered passages from the judgment. The script copies supporting evidence directly from those source passages. Nonblank CSV categories remain authoritative; automated additions are allowed only in categories absent from the CSV. Invalid references are excluded and recorded in `rejectedEvidence` for review. Existing evidence is preserved, and empty evidence may be filled for manually selected tags. A reviewed judgment can yield no additional factors. Manual classifications without supporting passages are retained without fabricated evidence.
- **Appeals:** extracts direct challenges in the judgment's own procedural history, checks quoted evidence and adjacent court/date direction, and creates `APPEAL` links from the reviewing decision to the challenged decision. Existing source-specific relationships can identify a duplicate export's original record. Existing `RELATED` links for the same directed pair are promoted when supported; reverse and skip-level legacy associations within the established chain are kept as `RELATED`. Preliminary references are not treated as appeals. Missing or ambiguous lower decisions remain external references, not invented database records. Intermediate steps require an identifiable source decision and evidence naming it. See `sample_queries/appeal_chain.sql` for a cycle-safe chain query.

Factor and appeal stages call the OpenAI API and incur normal API usage charges. Validated extraction responses are cached under the ignored `.cache/manual-enrichment/` directory using hashes of the model, document, manual tags and factor catalog. Repeated runs reuse unchanged extractions. The command saves a dated JSON report including errors, counts and appeal evidence. Failed cases do not prevent other cases from being processed; an error exit code signals that a retry or review is needed. Changes are incremental; a successful text/citation stage remains saved if later factor extraction fails.

Run enrichment regression tests with `node --import tsx/esm scripts/enrich_manual.test.ts`.

## Copy local database to VPS

When your local database is the version you want to keep, you can dump it locally and restore it on the VPS.

### 1. Dump the local database

Run this from the project root on your local machine:

```bash
mkdir -p backups/db
docker compose exec -T db \
  pg_dump \
  -U postgres \
  -d tmcdb \
  -Fc \
  --no-owner \
  --no-privileges \
  > backups/db/tmcdb.dump
```

This creates a custom-format dump at `backups/db/tmcdb.dump`.

### 2. Copy the dump file to the VPS

From your local machine:

```bash
scp backups/db/tmcdb.dump your-user@your-vps:/tmp/tmcdb.dump
```

### 3. Back up the current VPS database

Before restoring anything, create a backup on the VPS:

```bash
mkdir -p backups/db
docker compose exec -T db \
  pg_dump \
  -U postgres \
  -d tmcdb \
  -Fc \
  --no-owner \
  --no-privileges \
  > backups/db/tmcdb-before-restore.dump
```

### 4. Stop the app container on the VPS

This prevents writes during the restore:

```bash
docker compose stop tmcdb
```

### 5. Restore directly into the VPS database

```bash
docker compose exec -T db \
  pg_restore \
  -U postgres \
  -d tmcdb \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  < /tmp/tmcdb.dump
```

### 6. Start the app again

```bash
docker compose up -d tmcdb
rm -f /tmp/tmcdb.dump
```

At that point the VPS database should exactly match the local one you dumped.

### Rollback

If something looks wrong after the restore, stop the app and restore the backup dump:

```bash
docker compose stop tmcdb

docker compose exec -T db \
  pg_restore \
  -U postgres \
  -d tmcdb \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  < backups/db/tmcdb-before-restore.dump

docker compose up -d tmcdb
```

## Citation search and audit

Incoming citation questions use a dedicated authority resolver and search service. Ambiguous names require selection; unknown names require a complete case number or ECLI. Results distinguish verified document citations from uncertain docket mentions, show evidence, and support continuation without changing the selected authority. See [implementation and validation notes](docs/reviews/citation-search-implementation.md).

Preview citation link repairs and newly discovered references:

```bash
npm run citations:audit -- --report .cache/citation-audit/review.json
```

After reviewing that report, apply exactly its proposed changes:

```bash
npm run citations:audit -- --apply .cache/citation-audit/review.json
```

The repair preserves existing passages and checks for intervening changes. It commits one decision at a time and records progress beside the report; rerunning an applied report skips already completed repairs. Keep the report, which contains prior link values. A fresh audit should propose no further changes.

Read-only integration checks and query plans:

```bash
npm run citations:verify -- --timeouts --all-pages
```

This uses the configured database, runs deliberate six- and eleven-second test queries, verifies read-only execution, and saves results under `.cache/citation-audit/`. The normal search budgets can be configured with `SQL_STATEMENT_TIMEOUT_MS` and `SQL_TRANSACTION_TIMEOUT_MS`.
