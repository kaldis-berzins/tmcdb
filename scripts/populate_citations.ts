import "dotenv/config";
import { prisma } from "../lib/prisma";

const REPROCESS = process.env.REPROCESS === "true";

type TargetDecision = {
  id: string;
  sourceKey: string;
  caseNumber: string;
  text: string | null;
};

type CitationCandidate = {
  rawReference: string;
  normalizedReference: string;
  snippet: string;
};

type CitationRow = {
  citingDecisionId: string;
  citedDecisionId: string | null;
  citedReference: string | null;
  text: string;
};

const CITATION_PATTERNS = [
  /\b(?:Joined\s+Cases?\s+|Case\s+)?[CTFctf]\s*[-\u2010-\u2015]?\s*\d{1,4}\s*\/\s*\d{2,4}(?:\s+P(?:PU)?)?\b/g,
  /\b[Rr]\s*\d{1,4}\s*\/\s*\d{2,4}\s*-\s*\d\b/g,
];

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

function normalizeWhitespace(value: string): string {
  return value.replace(/[\u00a0\u2007\u202f]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCaseReference(value: string): string {
  let normalized = value.toUpperCase();
  normalized = normalized.replace(/[\u00ad]/g, "");
  normalized = normalized.replace(/[\u2010-\u2015\u2212]/g, "-");
  normalized = normalized.replace(/[()[\],.;:]+$/g, "");
  normalized = normalized.replace(/\s+(?:AND|ET|Y)$/g, "");
  normalized = normalized.replace(/^(?:JOINED\s+CASES?|CASES?|CASES)\s+/i, "");
  normalized = normalized.replace(/\s*\/\s*/g, "/");
  normalized = normalized.replace(/\s*-\s*/g, "-");
  normalized = normalizeWhitespace(normalized);

  const prefixedCourtMatch = normalized.match(/^([CTF])\s+(\d{1,4}\/\d{2,4})(.*)$/);
  if (prefixedCourtMatch) {
    const [, prefix, body, suffix] = prefixedCourtMatch;
    normalized = `${prefix}-${body}${suffix ?? ""}`.trim();
    normalized = normalizeWhitespace(normalized);
  }

  const compactCourtMatch = normalized.match(/^([CTF])(\d{1,4}\/\d{2,4})(.*)$/);
  if (compactCourtMatch) {
    const [, prefix, body, suffix] = compactCourtMatch;
    normalized = `${prefix}-${body}${suffix ?? ""}`.trim();
    normalized = normalizeWhitespace(normalized);
  }

  const boardMatch = normalized.match(/^R\s*(\d{1,4}\/\d{2,4}-\d)$/);
  if (boardMatch) {
    normalized = `R ${boardMatch[1]}`;
  }

  return normalized;
}

function buildReferenceVariants(value: string): string[] {
  const normalized = normalizeCaseReference(value);
  const variants = new Set<string>();

  if (!normalized) {
    return [];
  }

  variants.add(normalized);
  variants.add(normalized.replace(/^([CTF])-(\d)/, "$1 $2"));
  variants.add(normalized.replace(/^([CTF])\s+(\d)/, "$1-$2"));
  variants.add(normalized.replace(/^R\s+(\d)/, "R$1"));
  variants.add(normalized.replace(/^R(\d)/, "R $1"));

  return [...variants].map(normalizeCaseReference).filter(Boolean);
}

function splitIntoSnippets(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9(])/g)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function extractCandidates(text: string): CitationCandidate[] {
  const candidates: CitationCandidate[] = [];
  const seen = new Set<string>();

  for (const snippet of splitIntoSnippets(text)) {
    for (const pattern of CITATION_PATTERNS) {
      for (const match of snippet.matchAll(pattern)) {
        const rawReference = normalizeWhitespace(match[0] ?? "");
        const normalizedReference = normalizeCaseReference(rawReference);

        if (!normalizedReference) {
          continue;
        }

        const key = `${normalizedReference}|${snippet}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push({
          rawReference,
          normalizedReference,
          snippet,
        });
      }
    }
  }

  return candidates;
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

async function loadDecisionLookup() {
  const decisions = await prisma.decision.findMany({
    select: {
      id: true,
      caseNumber: true,
    },
  });

  const lookup = new Map<string, Set<string>>();

  for (const decision of decisions) {
    for (const variant of buildReferenceVariants(decision.caseNumber)) {
      const existing = lookup.get(variant) ?? new Set<string>();
      existing.add(decision.id);
      lookup.set(variant, existing);
    }
  }

  return lookup;
}

function resolveDecisionIds(
  rawReference: string,
  citingDecisionId: string,
  lookup: Map<string, Set<string>>
): string[] {
  const resolved = new Set<string>();

  for (const variant of buildReferenceVariants(rawReference)) {
    for (const decisionId of lookup.get(variant) ?? []) {
      if (decisionId !== citingDecisionId) {
        resolved.add(decisionId);
      }
    }
  }

  return [...resolved];
}

function isSelfReference(decision: TargetDecision, rawReference: string): boolean {
  const decisionVariants = new Set(buildReferenceVariants(decision.caseNumber));

  for (const variant of buildReferenceVariants(rawReference)) {
    if (decisionVariants.has(variant)) {
      return true;
    }
  }

  return false;
}

function toCitationRows(
  decision: TargetDecision,
  lookup: Map<string, Set<string>>
): CitationRow[] {
  if (!decision.text || !decision.text.trim()) {
    return [];
  }

  const rows: CitationRow[] = [];
  const seen = new Set<string>();

  for (const candidate of extractCandidates(decision.text)) {
    if (isSelfReference(decision, candidate.rawReference)) {
      continue;
    }

    const matches = resolveDecisionIds(
      candidate.rawReference,
      decision.id,
      lookup
    );

    const citedDecisionId = matches.length === 1 ? matches[0] ?? null : null;
    const citedReference = citedDecisionId ? candidate.normalizedReference : candidate.rawReference;
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

async function applyDecisionCitations(decisionId: string, rows: CitationRow[]) {
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
  });
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
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
