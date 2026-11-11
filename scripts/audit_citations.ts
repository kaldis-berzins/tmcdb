import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../lib/prisma';
import { loadDecisionLookup, resolveDecisionIds, toCitationRows, type CitationRow, type DecisionLookup, type TargetDecision } from './populate_citations';
import { normalizeCaseReference } from '../src/lib/citations/references';

type Existing = CitationRow & { id: string };
type Repair = { id: string; sourceKey: string; textHash: string; beforeHash: string; updates: { id: string; before: string | null; after: string | null; reference: string; passage: string }[]; additions: CitationRow[] };
type Report = { version: 1; createdAt: string; lookupHash: string; scanned: number; missingTexts: number; unvalidatedRows: number; repairs: Repair[] };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rowHash = (rows: Existing[]) => hash([...rows].sort((a, b) => a.id.localeCompare(b.id)));
const referenceKey = (row: CitationRow) => `${normalizeCaseReference(row.citedReference ?? '')}|${row.citedDecisionId ?? ''}`;
const lookupHash = (lookup: DecisionLookup) => hash({ entries: [...lookup].map(([k, ids]) => [k, [...ids].sort()]).sort(), dates: [...lookup.dates ?? []].sort(), types: [...lookup.types ?? []].sort() });

/** Preserve existing evidence. Repair links and add previously unrepresented references only. */
export function planRepair(decision: TargetDecision, existing: Existing[], lookup: DecisionLookup): Repair {
  const updates: Repair['updates'] = [];
  const revised = existing.map((row) => {
    if (!row.citedReference) return row;
    const matches = resolveDecisionIds(row.citedReference, decision.id, lookup, row.text);
    const after = matches.length === 1 ? matches[0]! : null;
    if (after !== row.citedDecisionId) updates.push({ id: row.id, before: row.citedDecisionId, after, reference: row.citedReference, passage: row.text });
    return { ...row, citedDecisionId: after };
  });
  const represented = new Set(revised.map(referenceKey));
  const additions: CitationRow[] = [];
  for (const row of toCitationRows(decision, lookup)) {
    const key = referenceKey(row);
    if (represented.has(key)) continue;
    represented.add(key);
    additions.push(row);
  }
  return { id: decision.id, sourceKey: decision.sourceKey, textHash: hash(decision.text), beforeHash: rowHash(existing), updates, additions };
}

async function main() {
  const args = process.argv.slice(2);
  const applyIndex = args.indexOf('--apply');
  const reportIndex = args.indexOf('--report');
  if (applyIndex < 0 && (reportIndex < 0 || !args[reportIndex + 1])) throw new Error('Usage: citations:audit -- --report <path.json>, or --apply <reviewed-report.json>');
  const lookup = await loadDecisionLookup();
  if (applyIndex >= 0) {
    const path = args[applyIndex + 1];
    if (!path) throw new Error('Missing reviewed report path');
    const report = JSON.parse(await readFile(path, 'utf8')) as Report;
    if (report.version !== 1 || report.lookupHash !== lookupHash(lookup)) throw new Error('Decision identities changed; generate and review a fresh audit.');
    const applied: string[] = [];
    const skipped: string[] = [];
    try {
      for (const repair of report.repairs) {
        const changed = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Decision" WHERE id = ${repair.id} FOR UPDATE`;
          const decision = await tx.decision.findUniqueOrThrow({ where: { id: repair.id }, select: { text: true } });
          if (hash(decision.text) !== repair.textHash) throw new Error(`Text changed for ${repair.sourceKey}; audit again.`);
          const existing = await tx.citation.findMany({ where: { citingDecisionId: repair.id } });
          if (rowHash(existing) !== repair.beforeHash) {
            const alreadyApplied = repair.updates.every((u) => existing.some((row) => row.id === u.id && row.citedDecisionId === u.after)) && repair.additions.every((a) => existing.some((row) => referenceKey(row) === referenceKey(a) && row.text === a.text));
            if (alreadyApplied) return false;
            throw new Error(`Citations changed for ${repair.sourceKey}; audit again.`);
          }
          for (const update of repair.updates) await tx.citation.update({ where: { id: update.id }, data: { citedDecisionId: update.after } });
          if (repair.additions.length) await tx.citation.createMany({ data: repair.additions });
          return true;
        }, { timeout: 15_000 });
        (changed ? applied : skipped).push(repair.id);
      }
    } finally {
      await writeFile(`${path}.applied.json`, JSON.stringify({ applied, skipped, remaining: report.repairs.length - applied.length - skipped.length }, null, 2));
    }
    console.log(JSON.stringify({ applied: applied.length, alreadyApplied: skipped.length, report: path }));
    return;
  }
  const report: Report = { version: 1, createdAt: new Date().toISOString(), lookupHash: lookupHash(lookup), scanned: 0, missingTexts: 0, unvalidatedRows: 0, repairs: [] };
  let after = '';
  while (true) {
    const decisions = await prisma.decision.findMany({ where: { id: { gt: after } }, orderBy: { id: 'asc' }, take: 25, select: { id: true, sourceKey: true, caseNumber: true, text: true } });
    if (!decisions.length) break;
    const citations = await prisma.citation.findMany({ where: { citingDecisionId: { in: decisions.map((d) => d.id) } } });
    for (const decision of decisions) {
      report.scanned++;
      after = decision.id;
      if (!decision.text?.trim()) report.missingTexts++;
      const existing = citations.filter((c) => c.citingDecisionId === decision.id);
      report.unvalidatedRows += existing.filter((c) => !c.citedReference).length;
      const repair = planRepair(decision, existing, lookup);
      if (repair.updates.length || repair.additions.length) report.repairs.push(repair);
    }
  }
  const path = args[reportIndex + 1]!;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ scanned: report.scanned, affectedDecisions: report.repairs.length, missingTexts: report.missingTexts, unvalidatedRows: report.unvalidatedRows, updates: report.repairs.reduce((n, r) => n + r.updates.length, 0), detached: report.repairs.flatMap((r) => r.updates).filter((u) => !u.after).length, additions: report.repairs.reduce((n, r) => n + r.additions.length, 0), report: path }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
