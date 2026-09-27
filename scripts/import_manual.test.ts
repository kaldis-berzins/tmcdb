import assert from "node:assert/strict";
import test from "node:test";
import { matchDecision, matchFactors, normalizeCaseNumber, parseCsv, readManualCsv } from "./import_manual";
import type { Candidate } from "./import_manual";

const csv = (rows: string[][]) => rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n");
const input = (extra: Record<string, string> = {}) => {
  const values = { "Case Number": "C-104/18 P", "CJEU/GC": "CJEU", Date: "2019-09-12", ...extra };
  return readManualCsv(csv([Object.keys(values), Object.values(values)]));
};
const entry = () => input().entries[0]!;
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "existing", sourceKey: "EUIPO_original", institution: "ECJ", caseNumber: "C-104/18 P",
  date: new Date("2019-09-12T00:00:00.000Z"), ...overrides,
});

test("CSV preserves quoted commas, escaped quotes, CRLF, BOM and multiline text", () => {
  assert.deepEqual(parseCsv('\uFEFFName,Note\r\n"a,b","one ""quote""\r\ntwo"\r\n'), [
    ["Name", "Note"], ["a,b", 'one "quote"\r\ntwo'],
  ]);
  assert.throws(() => parseCsv('a,"unclosed'), /Unterminated/);
  assert.throws(() => parseCsv('"a"garbage,b'), /quoting/);
});

test("normalizes Unicode hyphens, spaces, zero padding and appeal suffixes", () => {
  assert.equal(normalizeCaseNumber(" T‑0147 / 2021 "), "T-147/21");
  assert.equal(normalizeCaseNumber("c 0104/18 p"), "C-104/18 P");
  assert.equal(normalizeCaseNumber("R104/2018-1"), null);
});

test("imports only supplied values and reports unsupported columns", () => {
  const parsed = input({ "BF Outcome": "BF Found", "Short Name": "Koton", "Target Mark(s)": "", "Link(s) to Mark(s)": "https://euipo.europa.eu/eSearch/#details/trademarks/009723792" });
  assert.deepEqual(parsed.omittedColumns, ["Short Name"]);
  assert.equal(parsed.entries[0]!.data.badFaithOutcome, "CANCELLED");
  assert.equal(parsed.entries[0]!.data.trademarkNumber, "009723792");
  assert.equal(Object.hasOwn(parsed.entries[0]!.data, "trademarkName"), false);
  assert.equal(Object.hasOwn(parsed.entries[0]!.data, "text"), false);
});

test("rejects invalid dates, courts, outcomes, duplicate cases and malformed columns", () => {
  assert.throws(() => input({ Date: "2025-02-30" }), /invalid date/);
  assert.throws(() => input({ "CJEU/GC": "GC" }), /court/);
  assert.throws(() => input({ "BF Outcome": "Typo" }), /unknown BF Outcome/);
  assert.throws(() => readManualCsv("Case Number,CJEU/GC,Date\nC-1/24,CJEU,2025-01-01\nC‑1/24,CJEU,2025-01-01"), /duplicate CSV/);
  assert.throws(() => readManualCsv("Case Number,CJEU/GC,Date\nC-1/24,CJEU"), /expected 3 cells/);
  assert.throws(() => readManualCsv("Case Number,Case Number,CJEU/GC,Date"), /duplicate or blank/);
});

test("skips incomplete research placeholders explicitly", () => {
  const parsed = input({ "CJEU/GC": "", Date: "" });
  assert.equal(parsed.entries.length, 0);
  assert.match(parsed.warnings[0]!, /skipped incomplete/);
});

test("provisions are mapped only when their instrument is unambiguous", () => {
  const parsed = input({ "Legal Basis": "CR (EC) 207/2009", "Specific Provision": "Art. 52(1)(b), Art. 8(1)(b)" });
  assert.deepEqual(parsed.entries[0]!.provisions?.map((p) => p.label), ["Article 52(1)(b) CTMR", "Article 8(1)(b) CTMR"]);
  const ambiguous = input({ "Legal Basis": "CTMR 40/94, TMD 89/104/EEC", "Specific Provision": "Art. 51(1)(b), Art. 3(2)(d)" });
  assert.equal(ambiguous.entries[0]!.provisions, undefined);
  assert.match(ambiguous.warnings[0]!, /unambiguously/);
});

test("tag parsing preserves commas in labels and reuses existing taxonomy IDs", () => {
  const parsed = input({ "Doctrinal Tags": '"Definition: meaning, conduct, concept of BF", New tag' });
  const factors = [{ id: "D1", label: "Definition: meaning, conduct, concept of BF", category: "DOCTRINAL" as const }];
  const groups = matchFactors(parsed.entries[0]!, factors);
  assert.equal(groups[0]!.factors[0]!.id, "D1");
  assert.match(groups[0]!.factors[1]!.id, /^MANUAL_DOCTRINAL_/);
  assert.deepEqual(matchFactors(parsed.entries[0]!, [...factors, groups[0]!.factors[1]!]), groups);
});

test("matches normalized case identity while preserving the original database ID/key", () => {
  const existing = candidate({ caseNumber: "C‑0104/18 P" });
  assert.equal(matchDecision(entry(), [existing]), existing);
  assert.equal(matchDecision(entry(), [candidate({ caseNumber: "C-999/18" })]), undefined);
  // A single exact docket allows correcting the database's date from manual data.
  assert.equal(matchDecision(entry(), [candidate({ date: new Date("2019-09-13") })])?.id, "existing");
});

test("missing appeal suffix requires matching date; multiple matches are never guessed", () => {
  assert.equal(matchDecision(entry(), [candidate({ caseNumber: "C-104/18" })])?.id, "existing");
  assert.throws(() => matchDecision(entry(), [candidate({ caseNumber: "C-104/18", date: null })]), /possible duplicate/);
  assert.throws(() => matchDecision(entry(), [candidate(), candidate({ id: "duplicate" })]), /ambiguous/);
  assert.equal(matchDecision(entry(), [candidate(), candidate({ id: "order", date: new Date("2019-01-01") })])?.id, "existing");
  assert.throws(() => matchDecision(entry(), [candidate({ institution: "GC" })]), /ambiguous/);
});
