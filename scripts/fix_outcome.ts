import {
  BadFaithOutcome,
  Institution,
  LinkType,
} from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";

function normalizeOutcome(outcome: string | null | undefined): string {
  return (outcome ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeText(text: string | null | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function hasPartialSignal(text: string): boolean {
  return [
    "declared partially invalid",
    "trade mark partially invalid",
    "mark partially invalid",
    "eutm partially cancelled",
    "trade mark partially cancelled",
  ].some((phrase) => text.includes(phrase));
}

function isOutcomeThatLeavesLowerDecisionStanding(
  outcome: string | null | undefined
): boolean {
  const o = normalizeOutcome(outcome);

  return [
    "judgment confirmed",
    "decision confirmed",
    "appeal inadmissible",
  ].includes(o);
}

function inferBadFaithOutcomeFromText(decision: {
  institution: Institution;
  outcome: string | null;
  text: string | null;
}): BadFaithOutcome | null {
  const normalizedText = normalizeText(decision.text);
  if (!normalizedText) {
    return null;
  }

  const header = normalizedText.slice(0, 3000);

  if (
    header.includes(" no bad faith ") ||
    header.includes(" no bad faith -") ||
    header.includes(" no bad faith –")
  ) {
    return BadFaithOutcome.REJECTED;
  }

  if (
    normalizedText.includes("has not overcome the burden of proving that the eutm proprietor acted in bad faith") ||
    normalizedText.includes("failed to prove that the eutm proprietor acted in bad faith") ||
    normalizedText.includes("it has not been established that the eutm proprietor acted in bad faith")
  ) {
    return BadFaithOutcome.REJECTED;
  }

  if (
    (decision.institution === Institution.GC ||
      decision.institution === Institution.ECJ) &&
    isOutcomeThatLeavesLowerDecisionStanding(decision.outcome) &&
    header.includes(" bad faith ") &&
    !header.includes(" no bad faith ")
  ) {
    return BadFaithOutcome.CANCELLED;
  }

  if (
    decision.institution === Institution.BOA &&
    isOutcomeThatLeavesLowerDecisionStanding(decision.outcome)
  ) {
    const cancellationApplicantAppellant =
      /cancellation applicant\s*\/\s*appellant|appellant\s*\/\s*cancellation applicant|applicant for cancellation\s*\/\s*appellant/.test(
        header
      );
    const proprietorAppellant =
      /eutm proprietor\s*\/\s*appellant|appellant\s*\/\s*eutm proprietor|proprietor of the european union trade mark\s*\/\s*appellant/.test(
        header
      );
    const transferOrAssignmentDispute =
      header.includes("assignment applicant") ||
      normalizedText.includes("transfer ownership");

    if (cancellationApplicantAppellant && !transferOrAssignmentDispute) {
      return BadFaithOutcome.REJECTED;
    }

    if (proprietorAppellant) {
      if (hasPartialSignal(normalizedText)) {
        return BadFaithOutcome.PARTIAL;
      }

      return BadFaithOutcome.CANCELLED;
    }
  }

  return null;
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
  const danglingReferences = new Set<string>();

  for (const link of decision.outgoingLinks) {
    if (link.toDecision?.badFaithOutcome) {
      linkedOutcomes.push(link.toDecision.badFaithOutcome);
    } else if (link.externalReference) {
      danglingReferences.add(link.externalReference);
    }
  }

  for (const link of decision.incomingLinks) {
    if (link.fromDecision?.badFaithOutcome) {
      linkedOutcomes.push(link.fromDecision.badFaithOutcome);
    } else if (link.externalReference) {
      danglingReferences.add(link.externalReference);
    }
  }

  if (danglingReferences.size > 0) {
    const linkedDecisions = await prisma.decision.findMany({
      where: {
        sourceKey: { in: [...danglingReferences] },
      },
      select: {
        badFaithOutcome: true,
      },
    });

    for (const linkedDecision of linkedDecisions) {
      if (linkedDecision.badFaithOutcome) {
        linkedOutcomes.push(linkedDecision.badFaithOutcome);
      }
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
      institution: true,
      outcome: true,
      badFaithOutcome: true,
      text: true,
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
      const inferred = inferBadFaithOutcomeFromText(decision);
      mapped = inherited ?? inferred ?? proceduralFallback(decision.outcome);
    } else if (mapped === BadFaithOutcome.UNCLEAR) {
      mapped = inferBadFaithOutcomeFromText(decision) ?? mapped;
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
