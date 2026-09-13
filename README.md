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
