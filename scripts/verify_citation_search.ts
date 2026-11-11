import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { resolveCase } from '../src/lib/citations/authorities';
import { candidateQuery, findCitingDecisions } from '../src/lib/server/citation-search';
import { runReadOnlySql } from '../src/lib/server/sql';
import { withReadOnlyTransaction, classifyQueryError } from '../src/lib/server/read-only';

const report: unknown[] = [];
try {
  for (const name of ['Raimund v Aigner', 'Brauwelt', 'CeramTec', 'Koton', 'Lindt']) {
    const target = resolveCase(name).candidates[0]!;
    const started = performance.now();
    let result = await findCitingDecisions(target.key);
    let pages = 1;
    const seen = new Set(result.decisions.map((d) => d.id));
    while (process.argv.includes('--all-pages') && result.nextCursor) {
      result = await findCitingDecisions(target.key, { cursor: result.nextCursor });
      pages++;
      for (const decision of result.decisions) {
        assert.equal(seen.has(decision.id), false, 'Duplicate decision across pages');
        seen.add(decision.id);
      }
    }
    if (!result.hasMore) assert.equal(seen.size, result.total! + result.candidateTotal!);
    const searchMs = Math.round(performance.now() - started);
    const plan = await withReadOnlyTransaction((tx) => tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${candidateQuery(target, '', 25)}`));
    report.push({ name, pages, searchMs, distinctDecisions: seen.size, milliseconds: Math.round(performance.now() - started), result, plan });
    console.log(JSON.stringify({ name, pages, searchMs, distinctDecisions: seen.size, decisionsOnPage: result.decisions.length, total: result.total, verifiedSoFar: result.verifiedSoFar, candidatesSoFar: result.candidatesSoFar, hasMore: result.hasMore, elapsedMs: Math.round(performance.now() - started) }));
  }
  if (process.argv.includes('--timeouts')) {
    const result = await runReadOnlySql('SELECT 1 AS ok FROM pg_sleep(6)');
    assert.equal(result.rowCount, 1);
    await assert.rejects(runReadOnlySql('SELECT 1 FROM pg_sleep(11)'), (error: unknown) => classifyQueryError(error).kind === 'timeout');
    await assert.rejects(withReadOnlyTransaction((tx) => tx.$executeRaw`UPDATE "Decision" SET "sourceKey" = "sourceKey" WHERE false`));
    const limited = await runReadOnlySql('SELECT n FROM generate_series(1, 3) n', 2);
    assert.equal(limited.truncated, true);
    console.log('Timeout, row-cap and database read-only checks passed.');
  }
} finally {
  await mkdir('.cache/citation-audit', { recursive: true });
  await writeFile('.cache/citation-audit/search-verification.json', JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}
