# AGENTS.md

## Project
Trademark Cancellation Database (`tmcdb`) is a SvelteKit app backed by Prisma and Postgres.

The wider purpose of the app is to support an AI agent that can query a database of trademark cancellations within EUIPO.

## Stack
- SvelteKit
- TypeScript
- Prisma
- Postgres
- Vite

## Setup
- Install: `npm i`
- Start database: `docker compose up`
- Run migrations: `npx prisma migrate dev --name init`
- Generate Prisma client: `npx prisma generate`

## Common Commands
- Dev server: `npm run dev`
- Type check: `npm run check`
- Build: `npm run build`
- Prisma migrate + generate: `npm run migrate`
- Prisma Studio: `npm run studio`

## Repo Notes
- App code lives in `src/`
- Prisma schema and migrations live in `prisma/`
- Sample queries live in `sample_queries/`
- The `scripts/` directory is for scripts that import and process data into the database

## Working Preferences
- Prefer minimal, targeted changes
- Preserve existing style and structure
- Run `npm run check` after code changes when possible
- Do not change database schema unless the task requires it

## Things To Know
- The database is expected to run through Docker Compose
- Environment settings are in `.env`
- Treat existing uncommitted changes as intentional unless told otherwise
