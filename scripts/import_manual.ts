import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { BadFaithOutcome, FactorCategory, Institution } from "../generated/prisma/enums";
import type { Prisma } from "../generated/prisma/client";

const factorColumns = {
  "Conduct Tags": FactorCategory.CONDUCT,
  "Relationship Tags": FactorCategory.RELATIONSHIP,
  "Doctrinal Tags": FactorCategory.DOCTRINAL,
  "Inference Basis": FactorCategory.INFERENCE_BASIS,
};
const supportedColumns = new Set([
  "Case Number", "CJEU/GC", "Date", "eSearch/Curia Link", "CJEU Procedure Type",
  "BF Outcome", "Procedural Result", "Target Mark(s)", "Link(s) to Mark(s)",
  "Legal Basis", "Specific Provision", ...Object.keys(factorColumns),
]);

// Handles BOM, CRLF, embedded newlines, escaped quotes and quoted commas.
// Also used for the CSV-style lists inside tag cells.
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closed = false;
  const text = input.replace(/^\uFEFF/, "");
  const finishField = () => { row.push(field); field = ""; closed = false; };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ",") finishField();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else if (char === '"' && !field.trim() && !closed) {
      field = "";
      quoted = true;
    } else if (char === '"' || (closed && char.trim())) {
      throw new Error(`Invalid CSV quoting near character ${i + 1}`);
    } else if (!closed) field += char;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field || row.length || closed) finishRow();
  return rows;
}

export function normalizeCaseNumber(value: string): string | null {
  const compact = value.normalize("NFKC").toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s/g, "");
  const match = /^(C|T)-?0*(\d+)\/(\d{2}|\d{4})(P)?$/.exec(compact);
  if (!match) return null;
  return `${match[1]}-${Number(match[2])}/${match[3]!.slice(-2)}${match[4] ? " P" : ""}`;
}

type ProvisionInput = { code: string; article: string; label: string };
export type ManualEntry = {
  row: number;
  caseNumber: string;
  institution: Institution;
  data: {
    date?: Date;
    url?: string;
    decisionType?: string;
    outcome?: string;
    badFaithOutcome?: BadFaithOutcome;
    trademarkName?: string;
    trademarkNumber?: string;
  };
  provisions?: ProvisionInput[];
  tags: Array<{ category: FactorCategory; labels: string[] }>;
};

function parseList(value: string): string[] {
  const rows = parseCsv(value);
  if (rows.length > 1) throw new Error("Expected a single comma-separated list");
  return [...new Set((rows[0] ?? []).map((v) => v.trim()).filter(Boolean))];
}

export function readManualCsv(text: string) {
  const [headers, ...records] = parseCsv(text);
  if (!headers) throw new Error("CSV is empty");
  const names = headers.map((h) => h.trim());
  if (new Set(names).size !== names.length || names.some((h) => !h)) {
    throw new Error("CSV has duplicate or blank column names");
  }
  for (const required of ["Case Number", "CJEU/GC", "Date"]) {
    if (!names.includes(required)) throw new Error(`Missing column: ${required}`);
  }
  const warnings: string[] = [];
  const omittedColumns = names.filter((name) => !supportedColumns.has(name));
  const entries: ManualEntry[] = [];
  const seen = new Set<string>();
  for (const [index, cells] of records.entries()) {
    const row = index + 2;
    if (cells.length !== names.length) throw new Error(`Row ${row}: expected ${names.length} cells, got ${cells.length}`);
    const values = Object.fromEntries(names.map((name, i) => [name, cells[i]!.trim()]));
    const get = (name: string) => values[name] ?? "";
    const caseNumber = normalizeCaseNumber(get("Case Number"));
    if (!caseNumber) throw new Error(`Row ${row}: invalid case number ${get("Case Number")}`);
    if (!get("CJEU/GC") && !get("Date")) {
      warnings.push(`Row ${row} (${caseNumber}): skipped incomplete row (missing court and date)`);
      continue;
    }
    const institution = get("CJEU/GC") === "CJEU" ? Institution.ECJ
      : get("CJEU/GC") === "GC" ? Institution.GC : null;
    if (!institution || (caseNumber.startsWith("T-") !== (institution === Institution.GC))) {
      throw new Error(`Row ${row}: court does not match case number`);
    }
    // A single manual record per docket avoids order-dependent overwrites.
    const key = `${institution}:${caseNumber.replace(/ P$/, "")}`;
    if (seen.has(key)) throw new Error(`Row ${row}: duplicate CSV case ${caseNumber}`);
    seen.add(key);
    const data: ManualEntry["data"] = {};
    if (get("Date")) {
      const date = new Date(`${get("Date")}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(get("Date")) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== get("Date")) {
        throw new Error(`Row ${row}: invalid date ${get("Date")}`);
      }
      data.date = date;
    }
    for (const [column, field] of [
      ["eSearch/Curia Link", "url"], ["CJEU Procedure Type", "decisionType"],
      ["Procedural Result", "outcome"], ["Target Mark(s)", "trademarkName"],
    ] as const) {
      if (get(column)) data[field] = get(column);
    }
    if (data.url && !/^https?:\/\//i.test(data.url)) throw new Error(`Row ${row}: invalid decision URL`);
    const outcomes: Record<string, BadFaithOutcome> = {
      "BF Found": BadFaithOutcome.CANCELLED, "BF Not Found": BadFaithOutcome.REJECTED,
      "Remitted": BadFaithOutcome.REMITTED, "Partial": BadFaithOutcome.PARTIAL,
      "Unclear": BadFaithOutcome.UNCLEAR,
    };
    if (get("BF Outcome")) {
      const outcome = outcomes[get("BF Outcome")];
      if (!outcome) throw new Error(`Row ${row}: unknown BF Outcome ${get("BF Outcome")}`);
      data.badFaithOutcome = outcome;
    }
    if (get("Link(s) to Mark(s)")) {
      const numbers = parseList(get("Link(s) to Mark(s)")).map((link) =>
        /^https:\/\/euipo\.europa\.eu\/eSearch\/#details\/trademarks\/([A-Za-z0-9]+)\/?$/.exec(link)?.[1]
      );
      if (numbers.length === 1 && numbers[0]) data.trademarkNumber = numbers[0];
      else warnings.push(`Row ${row} (${caseNumber}): omitted trademark numbers/links; the schema has one trademarkNumber field and this cell has multiple or unsupported links`);
    }
    const entry: ManualEntry = { row, caseNumber, institution, data, tags: [] };
    const bases = parseList(get("Legal Basis"));
    if (get("Specific Provision") && bases.length === 1) {
      // Reuse the codes already used by the EUIPO importer where unambiguous.
      const codes: Record<string, string> = {
        "CTMR 40/94": "CTMR", "CR (EC) 207/2009": "CTMR", "EUTMR 2017/1001": "EUTMR",
      };
      const code = codes[bases[0]!] ?? bases[0]!;
      entry.provisions = parseList(get("Specific Provision")).map((value) => {
        const article = /^Art\.\s*(\d+(?:\([a-z0-9]+\))*)$/i.exec(value)?.[1];
        if (!article) throw new Error(`Row ${row}: invalid provision ${value}`);
        return { code, article, label: `Article ${article} ${code}` };
      });
    } else if (get("Specific Provision") || bases.length) {
      warnings.push(`Row ${row} (${caseNumber}): omitted Legal Basis / Specific Provision mapping; articles cannot be assigned unambiguously to one instrument`);
    }
    for (const [column, category] of Object.entries(factorColumns)) {
      if (get(column)) entry.tags.push({ category, labels: parseList(get(column)) });
    }
    entries.push(entry);
  }
  return { entries, warnings, omittedColumns, totalRows: records.length };
}

export type Candidate = {
  id: string; sourceKey: string; institution: Institution;
  caseNumber: string; date: Date | null;
};

export function matchDecision(entry: ManualEntry, decisions: Candidate[]): Candidate | undefined {
  const base = entry.caseNumber.replace(/ P$/, "");
  const candidates = decisions.filter((decision) =>
    normalizeCaseNumber(decision.caseNumber)?.replace(/ P$/, "") === base
  );
  if (!candidates.length) return undefined;
  // Multiple stored decisions may be distinct judgments/orders in one docket.
  // Never choose an arbitrary first row or create yet another duplicate.
  const sameDate = candidates.filter((d) => entry.data.date && d.date?.getTime() === entry.data.date.getTime());
  const selected = candidates.length === 1 ? candidates[0] : sameDate.length === 1 ? sameDate[0] : undefined;
  if (!selected || selected.institution !== entry.institution) {
    throw new Error(`Row ${entry.row} (${entry.caseNumber}): ambiguous existing decisions: ${candidates.map((d) => d.id).join(", ")}`);
  }
  // A missing appeal suffix is tolerated only with a matching decision date.
  if (normalizeCaseNumber(selected.caseNumber) !== entry.caseNumber && !sameDate.includes(selected)) {
    throw new Error(`Row ${entry.row} (${entry.caseNumber}): possible duplicate ${selected.id}, but appeal suffix/date disagree`);
  }
  return selected;
}

type FactorInput = { id: string; label: string; category: FactorCategory };
const normalizeLabel = (label: string) => label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export function matchFactors(entry: ManualEntry, factors: FactorInput[]) {
  return entry.tags.map(({ category, labels }) => {
    const selected: FactorInput[] = [];
    for (const label of labels) {
      const matches = factors.filter((f) => f.category === category && normalizeLabel(f.label) === normalizeLabel(label));
      if (matches.length > 1) throw new Error(`Ambiguous factor label: ${label}`);
      const id = `MANUAL_${category}_${createHash("sha256").update(normalizeLabel(label)).digest("hex").slice(0, 16)}`;
      if (!matches[0] && factors.some((f) => f.id === id)) throw new Error(`Factor ID collision for ${label}`);
      selected.push(matches[0] ?? { id, category, label });
    }
    return { category, factors: [...new Map(selected.map((factor) => [factor.id, factor])).values()] };
  });
}

export async function importManualCsv(tx: Prisma.TransactionClient, parsed: ReturnType<typeof readManualCsv>, dryRun: boolean, skipConflicts = false) {
  const decisions = await tx.decision.findMany({
    select: { id: true, sourceKey: true, institution: true, caseNumber: true, date: true },
  });
  const factors = await tx.factor.findMany();
  const warnings = [...parsed.warnings];
  const claimedIds = new Set<string>();
  const conflicts: Array<{ row: number; caseNumber: string; reason: string }> = [];
  // Validate the complete batch before the first write.
  const plan = parsed.entries.flatMap((entry) => {
    try {
      const existing = matchDecision(entry, decisions);
      if (existing && claimedIds.has(existing.id)) throw new Error(`Multiple CSV rows match ${existing.id}`);
      if (existing) claimedIds.add(existing.id);
      return [{ entry, existing, groups: matchFactors(entry, factors) }];
    } catch (error) {
      conflicts.push({ row: entry.row, caseNumber: entry.caseNumber, reason: String(error) });
      return [];
    }
  });
  const blocked = conflicts.length > 0 && !skipConflicts;
  const actions = [];
  for (const { entry, existing, groups } of plan) {
    const data = { ...entry.data, caseNumber: entry.caseNumber, institution: entry.institution, source: "MANUAL" as const };
    const action = {
      action: existing ? "update" : "create", caseNumber: entry.caseNumber,
      id: existing?.id ?? null, fields: data,
      provisions: entry.provisions ?? "preserve existing",
      factors: groups,
    };
    actions.push(action);
    if (dryRun || blocked) continue;
    const decision = existing
      ? await tx.decision.update({ where: { id: existing.id }, data })
      : await tx.decision.create({ data: { ...data, sourceKey: `MANUAL:${entry.institution}:${entry.caseNumber}` } });
    if (entry.provisions) {
      const provisionIds = [];
      for (const provision of entry.provisions) {
        const saved = await tx.provision.upsert({
          where: { code_article: { code: provision.code, article: provision.article } },
          create: provision, update: {}, select: { id: true },
        });
        provisionIds.push(saved.id);
      }
      await tx.decisionProvision.deleteMany({ where: { decisionId: decision.id } });
      await tx.decisionProvision.createMany({
        data: provisionIds.map((provisionId) => ({ decisionId: decision.id, provisionId })), skipDuplicates: true,
      });
    }
    for (const { category, factors: selected } of groups) {
      for (const factor of selected) {
        await tx.factor.upsert({ where: { id: factor.id }, create: factor, update: {} });
      }
      await tx.decisionFactor.deleteMany({ where: {
        decisionId: decision.id, factor: { category }, factorId: { notIn: selected.map((f) => f.id) },
      } });
      await tx.decisionFactor.createMany({
        data: selected.map(({ id: factorId }) => ({ decisionId: decision.id, factorId })), skipDuplicates: true,
      });
    }
    if (groups.length === Object.keys(factorColumns).length) {
      await tx.decision.update({ where: { id: decision.id }, data: { factorsProcessed: true } });
    }
  }
  return { dryRun, blocked, conflicts, totalRows: parsed.totalRows,
    plannedCreates: actions.filter((a) => a.action === "create").length,
    plannedUpdates: actions.filter((a) => a.action === "update").length,
    written: dryRun || blocked ? 0 : actions.length,
    skipped: parsed.totalRows - plan.length, omittedColumns: parsed.omittedColumns, warnings, actions };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Usage: npm run import:manual -- <file.csv> [--dry-run | --validate-only] [--skip-conflicts]");
    return;
  }
  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length !== 1 || (args.includes("--dry-run") && args.includes("--validate-only")) || args.some((arg) => arg.startsWith("--") && !["--dry-run", "--validate-only", "--skip-conflicts"].includes(arg))) {
    throw new Error("Usage: npm run import:manual -- <file.csv> [--dry-run | --validate-only] [--skip-conflicts]");
  }
  const parsed = readManualCsv(await readFile(paths[0]!, "utf-8"));
  if (args.includes("--validate-only")) {
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }
  const { prisma } = await import("../lib/prisma");
  try {
    const dryRun = args.includes("--dry-run");
    const result = await prisma.$transaction(async (tx) => {
      // Serialize writes against other importers; dry runs remain read-only.
      if (!dryRun) await tx.$executeRaw`LOCK TABLE "Decision", "Factor", "Provision" IN SHARE ROW EXCLUSIVE MODE`;
      return importManualCsv(tx, parsed, dryRun, args.includes("--skip-conflicts"));
    }, { timeout: 120000, isolationLevel: "Serializable" });
    console.log(JSON.stringify(result, null, 2));
    if (result.blocked) {
      console.error("No changes written: resolve the reported conflicts or use --skip-conflicts to import only unambiguous rows.");
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
