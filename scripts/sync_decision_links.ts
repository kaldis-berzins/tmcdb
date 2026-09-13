import { pathToFileURL } from "node:url";
import { LinkType } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";

type DecisionLinkEntry = {
  type: string;
  uniqueSolrKey: string;
  relatedCases: Array<{
    id: string;
  }>;
};

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mapLinkType(entryType: string): LinkType {
  return entryType === "APPEAL" ? LinkType.APPEAL : LinkType.RELATED;
}

async function getDecisionIdBySourceKey(
  sourceKeys: string[]
): Promise<Map<string, string>> {
  const uniqueSourceKeys = dedupeStrings(sourceKeys);
  const decisionIdBySourceKey = new Map<string, string>();

  if (uniqueSourceKeys.length === 0) {
    return decisionIdBySourceKey;
  }

  const decisions = await prisma.decision.findMany({
    where: {
      sourceKey: { in: uniqueSourceKeys },
    },
    select: {
      id: true,
      sourceKey: true,
    },
  });

  for (const decision of decisions) {
    if (decision.sourceKey) {
      decisionIdBySourceKey.set(decision.sourceKey, decision.id);
    }
  }

  return decisionIdBySourceKey;
}

export async function syncDecisionLinksForEntries(
  entries: DecisionLinkEntry[]
): Promise<{
  deleted: number;
  created: number;
  backfilled: number;
}> {
  const sourceKeys = entries.map((entry) => entry.uniqueSolrKey);
  const relatedSourceKeys = entries.flatMap((entry) =>
    entry.relatedCases.map((related) => related.id)
  );
  const decisionIdBySourceKey = await getDecisionIdBySourceKey([
    ...sourceKeys,
    ...relatedSourceKeys,
  ]);

  let deleted = 0;
  let created = 0;

  for (const entry of entries) {
    const fromDecisionId = decisionIdBySourceKey.get(entry.uniqueSolrKey);
    if (!fromDecisionId) continue;

    const deleteResult = await prisma.decisionLink.deleteMany({
      where: {
        fromDecisionId,
        linkType: { in: [LinkType.APPEAL, LinkType.RELATED] },
      },
    });
    deleted += deleteResult.count;

    const linkType = mapLinkType(entry.type);
    const seen = new Set<string>();

    const data = entry.relatedCases
      .map((related) => {
        const toDecisionId = decisionIdBySourceKey.get(related.id) ?? null;
        const externalReference = toDecisionId ? null : related.id;

        return {
          fromDecisionId,
          toDecisionId,
          externalReference,
          linkType,
        };
      })
      .filter((row) => {
        const dedupeKey = `${row.toDecisionId ?? "null"}|${row.externalReference ?? "null"}|${row.linkType}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });

    if (data.length > 0) {
      const createResult = await prisma.decisionLink.createMany({
        data,
      });
      created += createResult.count;
    }
  }

  const backfilled = await backfillDecisionLinks(sourceKeys);

  return { deleted, created, backfilled };
}

export async function backfillDecisionLinks(
  sourceKeys?: string[]
): Promise<number> {
  let candidateSourceKeys = dedupeStrings(sourceKeys ?? []);

  if (candidateSourceKeys.length === 0) {
    const unresolvedLinks = await prisma.decisionLink.findMany({
      where: {
        toDecisionId: null,
        externalReference: { not: null },
      },
      select: {
        externalReference: true,
      },
    });

    candidateSourceKeys = dedupeStrings(
      unresolvedLinks.map((link) => link.externalReference ?? "")
    );
  }

  const decisionIdBySourceKey = await getDecisionIdBySourceKey(
    candidateSourceKeys
  );

  let updated = 0;

  for (const [sourceKey, toDecisionId] of decisionIdBySourceKey) {
    const updateResult = await prisma.decisionLink.updateMany({
      where: {
        externalReference: sourceKey,
        toDecisionId: null,
      },
      data: {
        toDecisionId,
        externalReference: null,
      },
    });

    updated += updateResult.count;
  }

  return updated;
}

async function main() {
  const unresolvedBefore = await prisma.decisionLink.count({
    where: {
      toDecisionId: null,
      externalReference: { not: null },
    },
  });
  const updated = await backfillDecisionLinks();
  const unresolvedAfter = await prisma.decisionLink.count({
    where: {
      toDecisionId: null,
      externalReference: { not: null },
    },
  });

  console.log("Decision link sync complete.");
  console.log(`Resolved links: ${updated}`);
  console.log(`Unresolved before: ${unresolvedBefore}`);
  console.log(`Unresolved after: ${unresolvedAfter}`);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
