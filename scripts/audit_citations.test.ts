import test from 'node:test';
import assert from 'node:assert/strict';
import { planRepair } from './audit_citations';
import type { DecisionLookup } from './populate_citations';

test('audit detaches opinion citations from a judgment and preserves original evidence', () => {
  const lookup: DecisionLookup = Object.assign(new Map([['C-529/07', new Set(['judgment'])]]), { dates: new Map([['judgment', '2009-06-11']]) });
  const text = 'Opinion of 12 March 2009, C-529/07';
  const old = { id: 'citation', citingDecisionId: 'source', citedDecisionId: 'judgment', citedReference: 'C-529/07', text };
  const repair = planRepair({ id: 'source', sourceKey: 'source', caseNumber: 'T-1/20', text }, [old], lookup);
  assert.equal(repair.updates[0]?.after, null);
  assert.equal(repair.updates[0]?.before, 'judgment');
  assert.equal(repair.updates[0]?.passage, text);
  assert.equal(old.citedDecisionId, 'judgment');
  assert.equal(repair.additions.length, 0);
});
test('audit is idempotent and adds a missing Unicode reference without replacing passages', () => {
  const decision = { id: 'source', sourceKey: 'source', caseNumber: 'T-1/20', text: 'See R 406/2021‑1 and EU:C:2025:455.' };
  const first = planRepair(decision, [], new Map());
  assert.equal(first.additions.length, 2);
  const second = planRepair(decision, first.additions.map((row, i) => ({ ...row, id: String(i) })), new Map());
  assert.equal(second.additions.length, 0);
  assert.equal(second.updates.length, 0);
});
