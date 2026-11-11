import "dotenv/config";
import { pathToFileURL } from "node:url";
import { prisma } from "../lib/prisma";

import { AUTHORITIES } from "../src/lib/citations/authorities";
import { extractCandidates, normalizeCaseReference } from "../src/lib/citations/references";
export { extractCandidates, normalizeCaseReference } from "../src/lib/citations/references";

const REPROCESS = process.env.REPROCESS === "true";

export type TargetDecision = {
  id: string;
  sourceKey: string;
  caseNumber: string;
  text: string | null;
};

export type CitationRow = {
  citingDecisionId: string;
  citedDecisionId: string | null;
  citedReference: string | null;
  text: string;
};
export type DecisionLookup = Map<string, Set<string>> & { dates?: Map<string, string>; eclis?: Map<string, string>; types?: Map<string, string> };

function parsePositiveInt(value: string, flagName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${flagName} value "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}

function parseLimitArg(args: string[]): number | undefined {
  let limit: number | undefined;

  args.forEach((arg, index) => {
    if (arg === "--limit" || arg === "-l") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${arg}`);
      }
      limit = parsePositiveInt(value, arg);
    }

    if (arg.startsWith("--limit=")) {
      limit = parsePositiveInt(arg.slice("--limit=".length), "--limit");
    }
  });

  return limit;
}

function buildReferenceVariants(value: string): string[] {
  return [normalizeCaseReference(value)];
}

async function loadTargetDecisions(limit?: number): Promise<TargetDecision[]> {
  const whereClause = REPROCESS
    ? { text: { not: null as any } }
    : {
        text: { not: null as any },
        citationsProcessed: false,
      };

  return prisma.decision.findMany({
    where: whereClause,
    orderBy: { id: "asc" },
    ...(typeof limit === "number" ? { take: limit } : {}),
    select: {
      id: true,
      sourceKey: true,
      caseNumber: true,
      text: true,
    },
  });
}

export async function loadDecisionLookup(): Promise<DecisionLookup> {
  const decisions = await prisma.decision.findMany({
    select: {
      id: true,
      caseNumber: true,
      date: true,
      decisionType: true,
    },
  });

  const lookup: DecisionLookup = new Map();
  lookup.dates = new Map();
  lookup.eclis = new Map();
  lookup.types = new Map();

  for (const decision of decisions) {
    if (decision.date) lookup.dates.set(decision.id, decision.date.toISOString().slice(0, 10));
    const aliases = AUTHORITIES.filter((a) => a.caseNumber === normalizeCaseReference(decision.caseNumber) && a.date === lookup.dates!.get(decision.id)).flatMap((a) => a.ecli ? [a.ecli] : []);
    if (aliases.length === 1) {
      lookup.eclis.set(decision.id, aliases[0]!);
      lookup.types.set(decision.id, 'judgment');
    }
    const kind = decision.decisionType?.match(/opinion|judgment|order/i)?.[0]?.toLowerCase();
    if (kind) lookup.types.set(decision.id, kind);
    for (const variant of [...buildReferenceVariants(decision.caseNumber), ...aliases]) {
      const existing = lookup.get(variant) ?? new Set<string>();
      existing.add(decision.id);
      lookup.set(variant, existing);
    }
  }

  return lookup;
}

export function resolveDecisionIds(
  rawReference: string,
  citingDecisionId: string,
  lookup: DecisionLookup,
  snippet?: string
): string[] {
  const resolved = new Set<string>();

  for (const variant of buildReferenceVariants(rawReference)) {
    for (const decisionId of lookup.get(variant) ?? []) {
      if (decisionId !== citingDecisionId) {
        resolved.add(decisionId);
      }
    }
  }

  // Never add/remove a meaningful appeal suffix. A date is useful only when
  // the parser associates it with this exact reference, not another authority.
  if (snippet && lookup.dates) {
    const candidates = extractCandidates(snippet).filter((c) => c.normalizedReference === normalizeCaseReference(rawReference));
    const kinds = new Set(candidates.flatMap((c) => c.documentType ? [c.documentType] : []));
    if (kinds.size === 1 && lookup.types) {
      for (const id of resolved) if (lookup.types.has(id) && !kinds.has(lookup.types.get(id)! as 'opinion' | 'judgment' | 'order')) resolved.delete(id);
    }
    const eclis = new Set(candidates.flatMap((c) => c.ecli ? [c.ecli] : []));
    if (eclis.size === 1 && lookup.eclis) {
      for (const id of resolved) if (lookup.eclis.has(id) && !eclis.has(lookup.eclis.get(id)!)) resolved.delete(id);
    }
    const dates = new Set(candidates.flatMap((c) => c.date ? [c.date] : []));
    if (dates.size === 1) {
      return [...resolved].filter((id) => dates.has(lookup.dates!.get(id) ?? ""));
    }
  }
  return [...resolved];
}

export function toCitationRows(
  decision: TargetDecision,
  lookup: DecisionLookup
): CitationRow[] {
  if (!decision.text || !decision.text.trim()) {
    return [];
  }

  const rows: CitationRow[] = [];
  const seen = new Set<string>();

  for (const candidate of extractCandidates(decision.text)) {
    const matches = resolveDecisionIds(
      candidate.rawReference,
      decision.id,
      lookup,
      candidate.snippet
    );

    if (candidate.normalizedReference === lookup.eclis?.get(decision.id)) continue;
    const sameDocket = normalizeCaseReference(decision.caseNumber) === candidate.normalizedReference;
    // Keep a same-docket citation only when a local date identifies another document.
    if (sameDocket && (!candidate.date || !matches.length || candidate.date === lookup.dates?.get(decision.id))) continue;

    const citedDecisionId = matches.length === 1 ? matches[0] ?? null : null;
    const citedReference = candidate.rawReference; // Preserve source spelling; normalize on retrieval.
    const row: CitationRow = {
      citingDecisionId: decision.id,
      citedDecisionId,
      citedReference,
      text: candidate.snippet,
    };

    const dedupeKey = `${row.citedDecisionId ?? "null"}|${row.citedReference ?? "null"}|${row.text}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    rows.push(row);
  }

  return rows;
}

export async function applyDecisionCitations(decisionId: string, rows: CitationRow[]) {
  await prisma.$transaction(async (tx) => {
    await tx.citation.deleteMany({
      where: { citingDecisionId: decisionId },
    });

    if (rows.length > 0) {
      await tx.citation.createMany({
        data: rows,
      });
    }

    await tx.decision.update({
      where: { id: decisionId },
      data: { citationsProcessed: true },
    });
  }, { timeout: 15_000 });
}

export async function backfillCitations(targetIds?: string[]): Promise<number> {
  const lookup = await loadDecisionLookup();
  const unresolved = await prisma.citation.findMany({
    where: { citedDecisionId: null, citedReference: { not: null } },
    select: { id: true, citingDecisionId: true, citedReference: true, text: true },
  });
  let updated = 0;
  for (const citation of unresolved) {
    const matches = resolveDecisionIds(citation.citedReference!, citation.citingDecisionId, lookup, citation.text);
    if (matches.length !== 1 || (targetIds && !targetIds.includes(matches[0]!))) continue;
    updated += (await prisma.citation.updateMany({
      where: { id: citation.id, citedDecisionId: null }, data: { citedDecisionId: matches[0]! },
    })).count;
  }
  return updated;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseLimitArg(args);

  const decisions = await loadTargetDecisions(limit);
  const lookup = await loadDecisionLookup();

  console.log(
    `Found ${decisions.length} decision(s) to process${
      typeof limit === "number" ? ` (limit=${limit})` : ""
    }`
  );

  let processed = 0;
  let extracted = 0;
  let resolved = 0;
  let unresolved = 0;

  for (const decision of decisions) {
    const rows = toCitationRows(decision, lookup);

    await applyDecisionCitations(decision.id, rows);

    processed++;
    extracted += rows.length;
    resolved += rows.filter((row) => row.citedDecisionId).length;
    unresolved += rows.filter((row) => !row.citedDecisionId).length;

    console.log(
      `[DONE] ${decision.sourceKey} (${decision.caseNumber}) - ${rows.length} citations (${rows.filter((row) => row.citedDecisionId).length} resolved, ${rows.filter((row) => !row.citedDecisionId).length} unresolved)`
    );
  }

  console.log(
    `Finished citation backfill. Processed=${processed}, Extracted=${extracted}, Resolved=${resolved}, Unresolved=${unresolved}`
  );
  console.log(`Previously unresolved citations linked: ${await backfillCitations()}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
