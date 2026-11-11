import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityFromKey, resolveCase } from '../citations/authorities';
import { decisionMatch, passageEvidence, searchWithRepository, type SearchDecision, type SearchRepository } from './citation-search';
import { citationSummary } from '../citations/presentation';
import { classifyQueryError, QueryValidationError } from './read-only';
import { validateReadOnlySql } from './sql';
const target = resolveCase('CeramTec').candidates[0]!;
const fixture = (id: string, text: string): SearchDecision => ({ id, sourceKey: `source-${id}`, caseNumber: `R ${id}/2025-1`, date: null, institution: 'BOA', url: null, badFaithOutcome: null, text });
const repository = (decisions: SearchDecision[]): SearchRepository => ({
  coverage: async () => ({ decisions: decisions.length, missingTexts: 1, unprocessedDecisions: 2, unresolvedReferences: 3 }),
  batch: async (_target, after, take) => decisions.filter((d) => d.id > after).slice(0, take),
  citations: async () => []
});

test('exact case references are distinct and document identity requires evidence', () => {
  assert.equal(passageEvidence(target, 'T-17/24; C-117/24; C-17/24 P', 'citation').length, 0);
  assert.equal(passageEvidence(target, 'See C-17/24', 'citation')[0]?.verification, 'case_only');
  assert.equal(passageEvidence(target, 'Judgment of 19 June 2025, C-17/24', 'citation')[0]?.verification, 'verified');
  assert.equal(passageEvidence(target, 'Opinion of 19 June 2025, C-17/24', 'citation').length, 0);
  assert.equal(passageEvidence(target, 'Judgment of 12 December 2024, C-17/24', 'citation').length, 0);
});
test('a shared passage does not turn every stored row into a citation to the target', () => {
  assert.equal(passageEvidence(target, 'C-17/24 and C-999/23', 'citation', 'C-999/23').length, 0);
  assert.equal(passageEvidence(target, 'See EU:C:2025:455', 'citation', null)[0]?.verification, 'verified');
});
test('only the citing document is searched; missing target imports do not matter', () => {
  assert.equal(decisionMatch(target, fixture('a', 'C-999/23'), []), null);
  assert.equal(decisionMatch(target, fixture('b', 'See EU:C:2025:455'), [])?.verification, 'verified');
});
test('evidence follows the match deep in the document; source keys survive missing URLs', () => {
  const result = decisionMatch(target, fixture('a', 'Opening. '.repeat(1000) + 'See EU:C:2025:455 for the judgment.'), []);
  assert.ok(result);
  assert.ok(result.evidence[0]);
  assert.ok(result.evidence[0].passage.includes('EU:C:2025:455'));
  assert.ok(result.evidence[0].offset! > 8000);
  assert.equal(result.sourceKey, 'source-a');
  assert.equal(result.decisionUrl, null);
});
test('repeated mentions produce one decision with separate evidence', async () => {
  const result = await searchWithRepository(repository([fixture('a', 'See EU:C:2025:455. ' + 'Text. '.repeat(100) + 'See EU:C:2025:455 again.')]), target);
  assert.equal(result.decisions.length, 1);
  assert.equal(result.total, 1);
  assert.equal(result.decisions[0]?.evidenceCount, 2);
});
test('pagination across more than 500 decisions has no duplicate or omitted records', async () => {
  const repo = repository(Array.from({ length: 503 }, (_, i) => fixture(String(i).padStart(4, '0'), 'See EU:C:2025:455.')));
  const seen: string[] = [];
  let cursor: string | undefined;
  let result;
  do {
    result = await searchWithRepository(repo, target, { ...(cursor ? { cursor } : {}), pageSize: 100 });
    seen.push(...result.decisions.map((d) => d.id));
    if (result.hasMore) assert.equal(result.total, null);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(result.total, 503);
  assert.equal(new Set(seen).size, 503);
  assert.equal(seen.length, 503);
});
test('scan budget exposes continuation even with zero matches and preserves scope', async () => {
  const repo = repository([fixture('a', 'unrelated'), fixture('b', 'unrelated'), fixture('c', 'EU:C:2025:455')]);
  const first = await searchWithRepository(repo, target, { maxScanned: 2 });
  assert.equal(first.hasMore, true);
  assert.equal(first.total, null);
  assert.equal(first.decisions.length, 0);
  const second = await searchWithRepository(repo, target, { cursor: first.nextCursor! });
  assert.equal(second.total, 1);
  await assert.rejects(searchWithRepository(repo, resolveCase('Koton').candidates[0]!, { cursor: first.nextCursor! }), /another authority/);
});
test('case-only totals never count as verified citations and coverage is explicit', async () => {
  const result = await searchWithRepository(repository([fixture('a', 'C-17/24')]), target);
  assert.equal(result.total, 0);
  assert.equal(result.candidateTotal, 1);
  assert.match(citationSummary(result), /0 verified/);
  assert.match(citationSummary(result), /1 decision\(s\) lack text/);
  assert.equal(authorityFromKey('case:T-999/24').scope, 'case');
});
test('timeouts, connection problems and validation rejections remain distinct', () => {
  assert.equal(classifyQueryError(new Error('57014 canceling statement due to statement timeout')).kind, 'timeout');
  assert.equal(classifyQueryError(new Error('ECONNREFUSED')).kind, 'connection');
  assert.equal(classifyQueryError(new QueryValidationError('Only SELECT')).kind, 'validation');
  assert.equal(classifyQueryError(new Error('42601 syntax error')).kind, 'invalid_sql');
});
test('SQL still rejects writes, multiple statements and changes to transaction settings', () => {
  for (const sql of ['DELETE FROM "Decision"', 'WITH gone AS (DELETE FROM "Decision" RETURNING *) SELECT * FROM gone', 'SELECT 1; SELECT 2', "SELECT set_config('transaction_read_only', 'off', true)"]) assert.throws(() => validateReadOnlySql(sql));
  assert.equal(validateReadOnlySql("SELECT 'delete' AS message;"), "SELECT 'delete' AS message");
});

test('an adjacent conflicting ECLI is not overridden by a matching date', () => {
  assert.equal(passageEvidence(target, '19/06/2025, C-17/24, EU:C:2025:999', 'citation').length, 0);
  assert.equal(passageEvidence(target, 'C-17/24, EU:C:2025:455', 'citation')[0]?.verification, 'verified');
});

test('visible evidence prefers the current decision text with an offset', () => {
  const result = decisionMatch(target, fixture('a', 'Current passage about EU:C:2025:455.'), [{ citingDecisionId: 'a', citedReference: 'EU:C:2025:455', text: 'Older stored passage mentioning EU:C:2025:455.' }]);
  assert.equal(result?.evidence[0]?.source, 'decision_text');
  assert.notEqual(result?.evidence[0]?.offset, null);
});
