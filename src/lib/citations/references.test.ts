import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCandidates, normalizeCaseReference } from './references';
import { resolveCase } from './authorities';
import { resolveDecisionIds, toCitationRows, type DecisionLookup } from '../../../scripts/populate_citations';

test('extracts Unicode hyphens, soft hyphens, line breaks and nonbreaking spaces consistently', () => {
  for (const reference of ['C-17/24', 'C−17/24', 'C\u00ad-17/24', 'C‑17 /\n24', 'C\u00a017/24', 'C-00017/2024']) {
    assert.equal(extractCandidates(`See ${reference}.`)[0]?.normalizedReference, 'C-17/24');
  }
});
test('complete references prevent substring matches and preserve suffixes', () => {
  assert.deepEqual(extractCandidates('T-456/15 and T-56/15; 139 in 2016.').map((c) => c.normalizedReference), ['T-456/15', 'T-56/15']);
  assert.deepEqual(extractCandidates('C-17/24 P, C-17/24 ppu, C-17/24 P(R).').map((c) => c.normalizedReference), ['C-17/24 P', 'C-17/24 PPU', 'C-17/24 P(R)']);
  assert.equal(extractCandidates('ABC-17/24 or C-17/24567').length, 0);
});
test('ECLI and board references preserve identifiers and source offsets', () => {
  const text = 'See ECLI:EU:C:2025:455 and R1367/2025-1.';
  const candidates = extractCandidates(text);
  assert.deepEqual(candidates.map((c) => c.normalizedReference), ['EU:C:2025:455', 'R 1367/2025-1']);
  for (const c of candidates) assert.equal(text.slice(c.offset, c.offset + c.rawReference.length), c.rawReference);
});
test('dates belong to their local reference, not another authority in the passage', () => {
  const candidates = extractCandidates('See C-17/24 and the judgment of 12 December 2024 in C-999/23.');
  assert.equal(candidates[0]!.date, null);
  assert.equal(candidates[1]!.date, '2024-12-12');
  assert.equal(extractCandidates('Judgment of 19/06/2025, C-17/24')[0]!.date, '2025-06-19');
});
test('ambiguous document resolution does not borrow a date', () => {
  const lookup: DecisionLookup = Object.assign(new Map([['C-17/24', new Set(['judgment', 'opinion'])]]), { dates: new Map([['judgment', '2025-06-19'], ['opinion', '2024-12-12']]) });
  assert.equal(resolveDecisionIds('C-17/24', 'other', lookup, 'C-17/24 and judgment of 12 December 2024 in C-999/23').length, 2);
  assert.deepEqual(resolveDecisionIds('C-17/24', 'other', lookup, 'Judgment of 19 June 2025 in C-17/24'), ['judgment']);
});
test('same-docket references retain an identified opinion and exclude the judgment itself', () => {
  const lookup: DecisionLookup = Object.assign(new Map([['C-17/24', new Set(['judgment', 'opinion'])]]), { dates: new Map([['judgment', '2025-06-19'], ['opinion', '2024-12-12']]) });
  const rows = toCitationRows({ id: 'judgment', sourceKey: 'j', caseNumber: 'C-17/24', text: 'In Case C-17/24. The Opinion of 12 December 2024 in C-17/24 supports this conclusion.' }, lookup);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.citedDecisionId, 'opinion');
});
test('raw references survive ingestion, including unresolved ECLI citations', () => {
  const rows = toCitationRows({ id: 'x', sourceKey: 'x', caseNumber: 'T-1/20', text: 'See C−17/24 and EU:C:2025:455.' }, new Map());
  assert.equal(rows[0]?.citedReference, 'C−17/24');
  assert.equal(rows[1]?.citedReference, 'EU:C:2025:455');
  assert.equal(normalizeCaseReference(rows[0]!.citedReference!), 'C-17/24');
});
test('Raimund remains ambiguous; specific names and identifiers resolve independently of imports', () => {
  assert.equal(resolveCase('Which decisions cite Raimund?').status, 'ambiguous');
  assert.equal(resolveCase('Raimund Schmitt').candidates[0]?.caseNumber, 'T-56/15');
  assert.equal(resolveCase('Raimund v Aigner').candidates[0]?.caseNumber, 'C-425/16');
  assert.equal(resolveCase('CeramTec bad-faith judgment').candidates[0]?.ecli, 'EU:C:2025:455');
  assert.equal(resolveCase('unconfigured party').status, 'unresolved');
  assert.equal(resolveCase('T-999/24').candidates[0]?.scope, 'case');
  assert.equal(resolveCase('EU:T:2024:999').status, 'resolved');
});
