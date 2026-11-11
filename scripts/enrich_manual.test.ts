import assert from "node:assert/strict";
import test from "node:test";
import { filterEnrichment, findReference, groundPassageSelections, judgmentPassages, normalizeEvidence, referenceKey, validateEnrichment, validateJudgment } from "./enrich_manual";
import { normalizeCaseReference, resolveDecisionIds, toCitationRows } from "./populate_citations";
import type { DecisionLookup } from "./populate_citations";

test("citation normalization preserves meaningful appeal suffixes", () => {
  assert.equal(normalizeCaseReference("Case C‑00529 / 2007"), "C-529/07");
  const lookup = new Map([["C-104/18 P", new Set(["koton"])]]);
  assert.deepEqual(resolveDecisionIds("C-104/18", "other", lookup), []);
  assert.equal(toCitationRows({ id: "koton", sourceKey: "key", caseNumber: "C-104/18 P", text: "In Case C-104/18 P. Judgment in Case C-529/07." }, lookup).length, 1);
});

test("duplicate cited decisions remain unresolved", () => {
  const rows = toCitationRows({ id: "citing", sourceKey: "key", caseNumber: "C-100/02", text: "See judgment in Case T-147/21." }, new Map([["T-147/21", new Set(["a", "b"])]]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.citedDecisionId, null);
});

test("dated citations distinguish a judgment from an opinion in the same docket", () => {
  const lookup: DecisionLookup = new Map([["C-104/18 P", new Set(["judgment", "opinion"])]]);
  lookup.dates = new Map([["judgment", "2019-09-12"], ["opinion", "2019-04-04"]]);
  assert.deepEqual(resolveDecisionIds("C-104/18 P", "other", lookup, "Judgment of 12 September 2019, C-104/18 P"), ["judgment"]);
  assert.deepEqual(resolveDecisionIds("C-104/18 P", "other", lookup, "Opinion of 04/04/2019 in C-104/18 P"), ["opinion"]);
  assert.equal(resolveDecisionIds("C-104/18 P", "other", lookup).length, 2);
});

test("decision references include cancellation numbers and preserve ambiguity", () => {
  assert.equal(referenceKey("000008371"), referenceKey("8371 C"));
  const decisions = [{ id: "a", sourceKey: "original", caseNumber: "C-104/18 P" }, { id: "b", sourceKey: "duplicate", caseNumber: "C-104/18 P" }];
  assert.equal(findReference("C-104/18", decisions).length, 2);
  assert.deepEqual(findReference("original", decisions).map((d) => d.id), ["a"]);
});

test("factor evidence must exist verbatim and belong to the real catalog", () => {
  const quote = "The applicant acted in bad faith when filing the trade mark.";
  assert.equal(normalizeEvidence("bad\nfaith – “mark”"), 'bad faith - "mark"');
  const valid = { factors: [{ factorId: "C10", quote }], appeals: [] };
  assert.deepEqual(validateEnrichment(valid, quote, [{ id: "C10" }]), valid);
  assert.throws(() => validateEnrichment(valid, "This judgment says something else entirely.", [{ id: "C10" }]), /exact passage/);
  assert.throws(() => validateEnrichment(valid, quote, []), /Unknown factor/);
});

test("appeal evidence needs an actual challenged case and procedural wording", () => {
  const quote = "By its appeal, Koton seeks to set aside the judgment in Case T-687/16.";
  assert.equal(validateEnrichment({ factors: [], appeals: [{ fromReference: "C-104/18 P", toReference: "T-687/16", quote }] }, quote, []).appeals.length, 1);
  assert.throws(() => validateEnrichment({ factors: [], appeals: [{ fromReference: "C-104/18 P", toReference: "T-999/16", quote }] }, quote, []), /challenged decision/);
  const precedent = "As held in Case T-687/16, all the relevant circumstances must be considered.";
  assert.throws(() => validateEnrichment({ factors: [], appeals: [{ fromReference: "C-104/18 P", toReference: "T-687/16", quote: precedent }] }, precedent, []), /challenged decision/);
});

test("bad evidence is reported and excluded without discarding grounded findings", () => {
  const quote = "The applicant acted in bad faith when filing the trade mark.";
  const filtered = filterEnrichment({ factors: [{ factorId: "C10", quote }, { factorId: "D1", quote: "A fabricated explanation absent from the judgment." }], appeals: [] }, quote, [{ id: "C10" }, { id: "D1" }]);
  assert.deepEqual(filtered.result.factors, [{ factorId: "C10", quote }]);
  assert.equal(filtered.rejected.length, 1);
});

test("selected passage IDs copy exact source evidence and reject invented IDs", () => {
  const text = "The applicant acted in bad faith when filing the trade mark. All relevant circumstances must be considered.";
  const passages = judgmentPassages(text);
  const grounded = groundPassageSelections({ factors: [{ factorId: "C10", passageId: 0 }], appeals: [] }, passages);
  assert.equal(grounded.factors[0]!.quote, normalizeEvidence(text));
  assert.doesNotThrow(() => validateEnrichment(grounded, text, [{ id: "C10" }]));
  assert.throws(() => groundPassageSelections({ factors: [{ factorId: "C10", passageId: 999 }], appeals: [] }, passages));
});

test("download validation rejects bot pages, opinions and wrong judgments", () => {
  const text = `JUDGMENT OF THE COURT\nIn Case C-529/07\n${"Judgment reasoning. ".repeat(150)}`;
  assert.doesNotThrow(() => validateJudgment(text, "C-529/07"));
  assert.throws(() => validateJudgment(text, "C-100/02"), /header/);
  assert.throws(() => validateJudgment("Verify that you're not a robot", "C-529/07"), /usable/);
  assert.throws(() => validateJudgment(`OPINION OF ADVOCATE GENERAL\n${text}`, "C-529/07"), /opinion/);
});
