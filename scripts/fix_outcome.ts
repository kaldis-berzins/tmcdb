import { BadFaithOutcome, LinkType } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";

function normalizeOutcome(outcome: string | null | undefined): string {
  return (outcome ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Direct mapping where the outcome itself tells us what ultimately happened
 * to the EUTM/IR.
 */
function directBadFaithOutcome(
  outcome: string | null | undefined
): BadFaithOutcome | null {
  const o = normalizeOutcome(outcome);

  switch (o) {
    /**
     * Trade mark fully cancelled / invalidated / revoked.
     */
    case "eutm cancelled":
      return BadFaithOutcome.CANCELLED;

    /**
     * Trade mark partially cancelled / invalidated / revoked.
     */
    case "eutm partially cancelled":
    case "cancellation totally upheld and eutm/ir declared partially invalid":
    case "cancellation totally upheld and eutm/ir partially revoked":
    case "eutm partially assigned and cancelled for the remainder":
      return BadFaithOutcome.PARTIAL;

    /**
     * Cancellation/revocation request failed, so the trade mark survived.
     */
    case "cancellation rejected":
    case "cancellation rejected as inadmissible":
      return BadFaithOutcome.REJECTED;

    /**
     * No final substantive result.
     */
    case "remitted (further prosecution)":
      return BadFaithOutcome.REMITTED;

    case "case suspended":
    case "closed without decision":
    case "closed without deciding on the merits":
    case "without deciding on the merits":
      return BadFaithOutcome.UNCLEAR;

    /**
     * These are appellate/procedural outcomes.
     * They do not by themselves say what happened to the trade mark.
     *
     * We handle them later by trying to inherit from the appealed/lower decision.
     */
    case "judgment confirmed":
    case "decision confirmed":
    case "decision confirmed":
    case "decision annulled":
    case "decision partially annulled":
    case "judgment annulled":
    case "appeal inadmissible":
      return null;

    /**
     * Explicitly unknown/other.
     */
    case "unknown":
    case "other":
    case "others":
    case "":
      return BadFaithOutcome.UNCLEAR;

    default:
      return BadFaithOutcome.UNCLEAR;
  }
}

/**
 * Outcomes where the result depends on the underlying appealed decision.
 *
 * Example:
 * - "Decision confirmed" means the lower decision stands.
 *   If the lower decision cancelled the EUTM, then ultimate outcome = CANCELLED.
 *   If the lower decision rejected cancellation, then ultimate outcome = REJECTED.
 *
 * - "Appeal inadmissible" usually means the appealed decision stands.
 *
 * - "Decision annulled" / "Judgment annulled" is harder. Annulment may send the case
 *   back, or may change the result. Without more detail, we treat it as REMITTED
 *   unless a linked decision can clarify it.
 */
function isProceduralOutcome(outcome: string | null | undefined): boolean {
  const o = normalizeOutcome(outcome);

  return [
    "judgment confirmed",
    "decision confirmed",
    "decision confirmed",
    "decision annulled",
    "decision partially annulled",
    "judgment annulled",
    "appeal inadmissible",
  ].includes(o);
}

function proceduralFallback(outcome: string | null | undefined): BadFaithOutcome {
  const o = normalizeOutcome(outcome);

  switch (o) {
    case "decision annulled":
    case "decision partially annulled":
    case "judgment annulled":
      return BadFaithOutcome.REMITTED;

    case "judgment confirmed":
    case "decision confirmed":
    case "appeal inadmissible":
    default:
      return BadFaithOutcome.UNCLEAR;
  }
}

/**
 * Try to find a linked lower/earlier decision whose badFaithOutcome is already known.
 *
 * This assumes your DecisionLink with linkType APPEAL connects appeal decisions to
 * the earlier decision in one of these ways:
 *
 *   appeal decision -> lower decision
 * or
 *   lower decision -> appeal decision
 *
 * The script checks both directions.
 */
async function findLinkedKnownOutcome(
  decisionId: string
): Promise<BadFaithOutcome | null> {
  const decision = await prisma.decision.findUnique({
    where: { id: decisionId },
    include: {
      outgoingLinks: {
        where: { linkType: LinkType.APPEAL },
        include: {
          toDecision: true,
        },
      },
      incomingLinks: {
        where: { linkType: LinkType.APPEAL },
        include: {
          fromDecision: true,
        },
      },
    },
  });

  if (!decision) return null;

  const linkedOutcomes: BadFaithOutcome[] = [];

  for (const link of decision.outgoingLinks) {
    if (link.toDecision?.badFaithOutcome) {
      linkedOutcomes.push(link.toDecision.badFaithOutcome);
    }
  }

  for (const link of decision.incomingLinks) {
    if (link.fromDecision?.badFaithOutcome) {
      linkedOutcomes.push(link.fromDecision.badFaithOutcome);
    }
  }

  const useful = linkedOutcomes.filter(
    (x) => x !== BadFaithOutcome.UNCLEAR && x !== BadFaithOutcome.REMITTED
  );

  if (useful.length === 1) {
    return useful[0] || BadFaithOutcome.UNCLEAR;
  }

  /**
   * If multiple linked outcomes disagree, do not guess.
   */
  if (new Set(useful).size === 1 && useful.length > 1) {
    return useful[0] || BadFaithOutcome.UNCLEAR;
  }

  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const decisions = await prisma.decision.findMany({
    select: {
      id: true,
      sourceKey: true,
      caseNumber: true,
      outcome: true,
      badFaithOutcome: true,
    },
    orderBy: {
      date: "asc",
    },
  });

  let updated = 0;
  let unchanged = 0;

  for (const decision of decisions) {
    let mapped = directBadFaithOutcome(decision.outcome);

    if (mapped === null && isProceduralOutcome(decision.outcome)) {
      const inherited = await findLinkedKnownOutcome(decision.id);
      mapped = inherited ?? proceduralFallback(decision.outcome);
    }

    if (!mapped) {
      mapped = BadFaithOutcome.UNCLEAR;
    }

    if (decision.badFaithOutcome === mapped) {
      unchanged++;
      continue;
    }

    console.log(
      `${dryRun ? "[dry-run] " : ""}${decision.caseNumber} | ${
        decision.sourceKey
      } | "${decision.outcome}" | ${decision.badFaithOutcome ?? "null"} -> ${
        mapped
      }`
    );

    if (!dryRun) {
      await prisma.decision.update({
        where: { id: decision.id },
        data: {
          badFaithOutcome: mapped,
        },
      });
    }

    updated++;
  }

  console.log("");
  console.log(`Done.`);
  console.log(`Updated: ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Dry run: ${dryRun}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });