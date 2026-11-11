import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { authorityFromKey } from '../citations/authorities';
import { extractCandidates, normalizeCaseReference, referencePrefilter } from '../citations/references';
import type { Authority, CitationCoverage, CitationEvidence, CitationSearchResult, CitingDecision } from '../citations/types';
import { QueryValidationError, withReadOnlyTransaction } from './read-only';

export type SearchDecision = { id: string; sourceKey: string; caseNumber: string; date: Date | null; institution: string; url: string | null; badFaithOutcome: string | null; text: string | null };
export type StoredCitation = { citingDecisionId: string; citedReference: string | null; text: string };
export type SearchRepository = {
  coverage(): Promise<CitationCoverage>;
  batch(target: Authority, after: string, take: number): Promise<SearchDecision[]>;
  citations(target: Authority, ids: string[]): Promise<StoredCitation[]>;
};
const cursorSecret = randomBytes(32);
type Cursor = { target: string; after: string; verified: number; candidates: number; started: number };
function encodeCursor(cursor: Cursor): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${payload}.${createHmac('sha256', cursorSecret).update(payload).digest('base64url')}`;
}
function decodeCursor(value: string | undefined, target: string): Cursor {
  if (!value) return { target, after: '', verified: 0, candidates: 0, started: Date.now() };
  try {
    const [payload, signature] = value.split('.');
    const expected = createHmac('sha256', cursorSecret).update(payload!).digest();
    const supplied = Buffer.from(signature!, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
    const cursor = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Cursor;
    if (cursor.target !== target || Date.now() - cursor.started > 30 * 60_000) throw new Error();
    return cursor;
  } catch { throw new QueryValidationError('The continuation expired or belongs to another authority. Restart the search.'); }
}

export function passageEvidence(target: Authority, text: string, source: CitationEvidence['source'], citedReference?: string | null): CitationEvidence[] {
  if (citedReference) {
    const reference = normalizeCaseReference(citedReference);
    if (reference !== target.caseNumber && reference !== target.ecli) return [];
  }
  return extractCandidates(text).flatMap((candidate): CitationEvidence[] => {
    const ecliMatch = candidate.normalizedReference === target.ecli;
    if (!ecliMatch && candidate.normalizedReference !== target.caseNumber) return [];
    if (!ecliMatch && target.scope === 'document' && ((candidate.ecli && target.ecli && candidate.ecli !== target.ecli) || (candidate.date && target.date && candidate.date !== target.date) || (candidate.documentType && target.documentType && candidate.documentType !== target.documentType))) return [];
    const verified = ecliMatch || (target.ecli !== null && candidate.ecli === target.ecli) || target.scope === 'case' || (target.date !== null && candidate.date === target.date);
    return [{ reference: candidate.rawReference, passage: candidate.snippet, offset: source === 'decision_text' ? candidate.offset : null, source, verification: verified ? 'verified' : 'case_only' }];
  });
}

export function decisionMatch(target: Authority, decision: SearchDecision, citations: StoredCitation[]): CitingDecision | null {
  const sameDocket = target.caseNumber !== null && normalizeCaseReference(decision.caseNumber) === target.caseNumber;
  if (sameDocket && target.date && decision.date?.toISOString().slice(0, 10) === target.date) return null;
  if (target.ecli && decision.url?.toUpperCase().includes(encodeURIComponent(target.ecli))) return null;
  let evidence = passageEvidence(target, decision.text ?? '', 'decision_text');
  // Existing links are candidate selectors, never proof of identity by themselves.
  evidence.push(...citations.flatMap((citation) => passageEvidence(target, citation.text, 'citation', citation.citedReference)));
  if (sameDocket) evidence = evidence.filter((e) => e.verification === 'verified' && target.scope === 'document');
  // Prefer full-text evidence with offsets, and collapse ingestion copies of the same passage.
  evidence = [...new Map([...evidence].reverse().map((e) => [`${normalizeCaseReference(e.reference)}|${e.passage.replace(/\s+/g, ' ')}`, e])).values()];
  evidence.sort((a, b) => Number(b.source === 'decision_text') - Number(a.source === 'decision_text'));
  if (!evidence.length) return null;
  return {
    id: decision.id, sourceKey: decision.sourceKey, caseNumber: decision.caseNumber,
    date: decision.date?.toISOString().slice(0, 10) ?? null, institution: decision.institution,
    decisionUrl: decision.url, badFaithOutcome: decision.badFaithOutcome,
    verification: evidence.some((e) => e.verification === 'verified') ? 'verified' : 'case_only',
    evidenceCount: evidence.length, evidence: evidence.slice(0, 5)
  };
}

export async function searchWithRepository(repository: SearchRepository, target: Authority, options: { cursor?: string; pageSize?: number; maxScanned?: number } = {}): Promise<CitationSearchResult> {
  const cursor = decodeCursor(options.cursor, target.key);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const maxScanned = options.maxScanned ?? 300;
  const coverage = await repository.coverage();
  const decisions: CitingDecision[] = [];
  let after = cursor.after;
  let scanned = 0;
  let hasMore = false;
  const started = Date.now();
  scan: while (scanned < maxScanned && Date.now() - started < 8_000) {
    const batchSize = Math.min(25, maxScanned - scanned);
    const batch = await repository.batch(target, after, batchSize);
    if (!batch.length) { hasMore = false; break; }
    const citations = await repository.citations(target, batch.map((d) => d.id));
    for (const decision of batch) {
      const match = decisionMatch(target, decision, citations.filter((c) => c.citingDecisionId === decision.id));
      if (match && decisions.length === pageSize) { hasMore = true; break scan; }
      after = decision.id;
      scanned++;
      if (match) decisions.push(match);
    }
    if (batch.length < batchSize) { hasMore = false; break; }
    hasMore = true; // Budget exhaustion needs continuation, even if no verified match was found.
  }
  const verifiedSoFar = cursor.verified + decisions.filter((d) => d.verification === 'verified').length;
  const candidatesSoFar = cursor.candidates + decisions.filter((d) => d.verification === 'case_only').length;
  const limitations = [
    'Results cover the stored collection and supported identifier formats, not all EUIPO case law.',
    'Case-only matches do not establish which judgment, order or opinion was cited.',
    'Evidence counts count extracted passages, not every literal occurrence. Up to five passages are displayed per decision.',
    'Pagination is ordered by decision ID. Restart if the corpus changes during the search.'
  ];
  if (coverage.missingTexts || coverage.unprocessedDecisions) limitations.push(`${coverage.missingTexts} decisions lack text; ${coverage.unprocessedDecisions} have not completed citation processing.`);
  if (!target.caseNumber) limitations.push('For an ECLI without docket metadata, self-citations cannot always be excluded.');
  return {
    ok: true, target, decisions, hasMore, nextCursor: hasMore ? encodeCursor({ ...cursor, after, verified: verifiedSoFar, candidates: candidatesSoFar }) : null,
    total: hasMore ? null : verifiedSoFar, candidateTotal: hasMore ? null : candidatesSoFar,
    verifiedSoFar, candidatesSoFar, status: hasMore ? 'partial' : 'complete', scanned, coverage, limitations
  };
}

export function targetPattern(target: Authority): string {
  return [target.caseNumber, target.ecli].filter((r): r is string => r !== null).map(referencePrefilter).join('|');
}
export function candidateQuery(target: Authority, after: string, take: number) {
  const pattern = targetPattern(target);
  return Prisma.sql`SELECT d."id", d."sourceKey", d."caseNumber", d."date", d."institution", d."url", d."badFaithOutcome", d."text"
    FROM "Decision" d WHERE d."id" > ${after} AND (
      d."text" ~* ${pattern} OR EXISTS (SELECT 1 FROM "Citation" c WHERE c."citingDecisionId" = d."id" AND (c."citedReference" ~* ${pattern} OR (c."citedReference" IS NULL AND c.text ~* ${pattern}) OR c."citedDecisionId" IN (SELECT id FROM "Decision" WHERE "caseNumber" = ${target.caseNumber})))
    ) ORDER BY d."id" LIMIT ${take}`;
}
export function databaseRepository(tx: Prisma.TransactionClient): SearchRepository {
  return {
    async coverage() {
      const [coverage] = await tx.$queryRaw<CitationCoverage[]>`SELECT count(*)::int AS decisions,
        count(*) FILTER (WHERE text IS NULL OR btrim(text) = '')::int AS "missingTexts",
        count(*) FILTER (WHERE NOT "citationsProcessed")::int AS "unprocessedDecisions",
        (SELECT count(*)::int FROM "Citation" WHERE "citedDecisionId" IS NULL)::int AS "unresolvedReferences" FROM "Decision"`;
      return coverage!;
    },
    batch: (target, after, take) => tx.$queryRaw<SearchDecision[]>(candidateQuery(target, after, take)),
    citations: (target, ids) => tx.$queryRaw<StoredCitation[]>`SELECT "citingDecisionId", "citedReference", text FROM "Citation"
      WHERE "citingDecisionId" IN (${Prisma.join(ids)}) AND ("citedReference" ~* ${targetPattern(target)} OR ("citedReference" IS NULL AND text ~* ${targetPattern(target)}))`
  };
}
export async function findCitingDecisions(key: string, options: { cursor?: string; pageSize?: number } = {}) {
  let target: Authority;
  try { target = authorityFromKey(key); } catch { throw new QueryValidationError('Resolve a complete authority identifier before searching.'); }
  return withReadOnlyTransaction((tx) => searchWithRepository(databaseRepository(tx), target, options));
}
