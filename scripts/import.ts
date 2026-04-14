import { prisma } from "../lib/prisma";
import { chromium, type BrowserContext } from "playwright";
import { readFile } from "node:fs/promises";
import fs from "node:fs/promises";
import { z } from "zod";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { PDFParse } from "pdf-parse";

// Adjust this import to wherever your generated enums come from.
// If you use @prisma/client, import from there instead.
import {
  Institution,
  SourceType,
  LinkType,
} from "../generated/prisma/enums";

// -------------------------
// Runtime-validated input types
// -------------------------

const languageSchema = z.object({
  code: z.string(),
  label: z.string().optional(),
  pdfUrl: z.string(),
  serviceProvider: z.string().optional(),
});

const relatedCaseSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  url: z.string().optional(),
});

const entrySchema = z.object({
  type: z.string(),
  typeLabel: z.string().optional(),
  date: z.string().optional(),
  uniqueSolrKey: z.string(),
  url: z.string().optional(),

  languagesOriginal: z.array(languageSchema).default([]),
  languagesHumanTranslated: z.array(languageSchema).default([]),
  languagesMachineTranslated: z.array(languageSchema).default([]),

  quotation: z.string().optional(),
  documentKind: z.string().optional(),
  caseNumber: z.string(),
  ipRight: z.string().optional(),
  outcome: z.string().optional(),
  appealed: z.string().optional(),
  entityNumber: z.string().optional(),
  entityStatus: z.string().optional(),
  norms: z.array(z.string()).default([]),
  relatedCases: z.array(relatedCaseSchema).default([]),
  entityImage: z.string().optional(),
  entityName: z.string().optional(),
  entityType: z.string().optional(),
  nickName: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  summary: z.string().optional(),
  earlierName: z.string().optional(),
  entityResult: z.string().optional(),
  deemedDeliveredToAppellantDate: z.string().optional(),
  deemedDeliveredToDefendantDate: z.string().optional(),
  cancelledClasses: z.array(z.string()).optional(),
});

const rootSchema = z.object({
  errorLabel: z.unknown().nullable().optional(),
  results: z.array(entrySchema).default([]),
  numFound: z.number().optional(),
});

type EuipoEntry = z.infer<typeof entrySchema>;
type EuipoLanguage = z.infer<typeof languageSchema>;
type EuipoInput = z.infer<typeof rootSchema>;

// -------------------------
// Download + text extraction
// -------------------------

export async function downloadDocumentToString(
  url: string,
  context: BrowserContext,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  const { timeoutMs = 30000 } = options;
  const page = await context.newPage();

  try {
    const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });

    await page.goto(url, { waitUntil: "commit", timeout: timeoutMs }).catch((err) => {
      const msg = String(err).toLowerCase();
      if (
        !msg.includes("err_aborted") &&
        !msg.includes("interrupted") &&
        !msg.includes("download is starting")
      ) {
        throw err;
      }
    });

    const download = await downloadPromise;

    const failure = await download.failure();
    if (failure) {
      throw new Error(`Download failed: ${failure}`);
    }

    const filePath = await download.path();
    if (!filePath) {
      throw new Error("Could not access downloaded file path");
    }

    const filename = download.suggestedFilename().toLowerCase();

    if (filename.endsWith(".pdf")) {
      const buffer = await readFile(filePath);
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy();
      }
    }

    if (filename.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    if (filename.endsWith(".doc")) {
      const extractor = new WordExtractor();
      const doc = await extractor.extract(filePath);
      return doc.getBody();
    }

    throw new Error(`Unsupported file type: ${filename}`);
  } finally {
    await page.close().catch(() => {});
  }
}

// -------------------------
// Mapping helpers
// -------------------------

function pickUrl(entry: EuipoEntry): { languageCode: string; url: string, originalLanguageCode: string, originalLanguageURL: string } | null {
  const languages: EuipoLanguage[] = [
    ...entry.languagesOriginal,
    ...entry.languagesHumanTranslated,
    ...entry.languagesMachineTranslated,
  ];

  const englishEntry = languages.find((lang) => lang.code === "en");
  if (englishEntry && entry.languagesOriginal[0]) {
    return { languageCode: englishEntry.code, url: englishEntry.pdfUrl, originalLanguageCode: entry.languagesOriginal[0].code, originalLanguageURL: entry.languagesOriginal[0].pdfUrl };
  }

  if (languages.length > 0) {
    const lang = languages[0];
    if (lang) {
      return { languageCode: lang.code, url: lang.pdfUrl, originalLanguageCode: entry.languagesOriginal[0]?.code ?? lang.code, originalLanguageURL: entry.languagesOriginal[0]?.pdfUrl ?? lang.pdfUrl };
    }
  }

  return null;
}

function parseEuipoDate(value?: string): Date | null {
  if (!value) return null;

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);

  // Use UTC to avoid timezone surprises
  return new Date(Date.UTC(year, month - 1, day));
}

function mapInstitution(entry: EuipoEntry): Institution {
  if (entry.type === "CANCELLATION") return Institution.CD;
  if (entry.type === "APPEAL") return Institution.BOA;

  if (entry.type === "INSTANCE_OF_ECJ") {
    if (entry.typeLabel === "General Court") return Institution.GC;
    if (entry.typeLabel === "Court of Justice") return Institution.ECJ;
  }

  return Institution.OTHER;
}

/**
 * Example:
 * "Article 59(1)(b) EUTMR"
 * -> { code: "EUTMR", article: "59(1)(b)", label: "Article 59(1)(b) EUTMR" }
 *
 * Fallbacks are intentionally conservative.
 */
function parseProvisionLabel(label: string): {
  code: string;
  article: string;
  label: string;
} {
  const trimmed = label.trim();

  const match = /^Article\s+(.+?)\s+([A-Z][A-Z0-9-]*)$/.exec(trimmed);
  if (match && match[1] && match[2]) {
    return {
      article: match[1].trim(),
      code: match[2].trim(),
      label: trimmed,
    };
  }

  return {
    code: "UNKNOWN",
    article: trimmed,
    label: trimmed,
  };
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function mapLinkType(entry: EuipoEntry): LinkType {
  // Assumption:
  // - an APPEAL entry linking to a related decision is an APPEAL link
  // - everything else is RELATED
  return entry.type === "APPEAL" ? LinkType.APPEAL : LinkType.RELATED;
}

// -------------------------
// DB sync helpers
// -------------------------

async function syncProvisions(decisionId: string, norms: string[]): Promise<void> {
  const uniqueNorms = dedupeStrings(norms);

  const provisionIds: string[] = [];

  for (const norm of uniqueNorms) {
    const parsed = parseProvisionLabel(norm);

    const provision = await prisma.provision.upsert({
      where: {
        label: parsed.label,
      },
      update: {
        code: parsed.code,
        article: parsed.article,
      },
      create: {
        code: parsed.code,
        article: parsed.article,
        label: parsed.label,
      },
      select: {
        id: true,
      },
    });

    provisionIds.push(provision.id);
  }

  await prisma.decisionProvision.deleteMany({
    where: { decisionId },
  });

  if (provisionIds.length > 0) {
    await prisma.decisionProvision.createMany({
      data: provisionIds.map((provisionId) => ({
        decisionId,
        provisionId,
      })),
      skipDuplicates: true,
    });
  }
}

async function upsertDecisionFromEntry(
  entry: EuipoEntry,
  context: BrowserContext
): Promise<{ id: string; sourceKey: string }> {
  const chosen = pickUrl(entry);

  let textUrl: string | null = null;
  let textLanguage: string | null = null;
  let text: string | null = null;

  if (chosen) {
    textUrl = chosen.url;
    textLanguage = chosen.languageCode;

    try {
      text = await downloadDocumentToString(chosen.url, context, { timeoutMs: 60000 });
      console.log(`Extracted text for case ${entry.caseNumber}`);
    } catch (err) {
      console.warn(`Failed to extract text for case ${entry.caseNumber}:`, err);
      console.log("Falling back to original language if different...");

      if (chosen.originalLanguageURL && chosen.originalLanguageURL !== chosen.url) {
        try {
          text = await downloadDocumentToString(chosen.originalLanguageURL, context, { timeoutMs: 60000 });
          textUrl = chosen.originalLanguageURL;
          textLanguage = chosen.originalLanguageCode;
          console.log(`Extracted text from original language for case ${entry.caseNumber}`);
        } catch (err) {
          throw new Error(`Failed to extract text from both chosen and original language for case ${entry.caseNumber}. Last error: ${err}`);
        }
      }


    }
  } else {
    console.warn(`No downloadable document found for case ${entry.caseNumber}`);
  }

  const decision = await prisma.decision.upsert({
    where: {
      sourceKey: entry.uniqueSolrKey,
    },
    update: {
      institution: mapInstitution(entry),
      source: SourceType.EUIPO,
      caseNumber: entry.caseNumber,
      date: parseEuipoDate(entry.date),
      url: entry.url ?? null,
      decisionType: entry.typeLabel ?? null,
      outcome: entry.outcome ?? null,
      trademarkNumber: entry.entityNumber ?? null,
      trademarkName: entry.entityName ?? null,
      textUrl,
      textLanguage,
      text,
      // factorsProcessed / citationsProcessed remain false by default,
      // and we do not touch them here.
    },
    create: {
      sourceKey: entry.uniqueSolrKey,
      institution: mapInstitution(entry),
      source: SourceType.EUIPO,
      caseNumber: entry.caseNumber,
      date: parseEuipoDate(entry.date),
      url: entry.url ?? null,
      decisionType: entry.typeLabel ?? null,
      outcome: entry.outcome ?? null,
      trademarkNumber: entry.entityNumber ?? null,
      trademarkName: entry.entityName ?? null,
      textUrl,
      textLanguage,
      text,
    },
    select: {
      id: true,
      sourceKey: true,
    },
  });

  await syncProvisions(decision.id, entry.norms);

  return {
    id: decision.id,
    sourceKey: decision.sourceKey ?? entry.uniqueSolrKey,
  };
}

async function syncDecisionLinks(entries: EuipoEntry[]): Promise<void> {
  const sourceKeys = entries.map((e) => e.uniqueSolrKey);

  const decisions = await prisma.decision.findMany({
    where: {
      sourceKey: { in: sourceKeys },
    },
    select: {
      id: true,
      sourceKey: true,
    },
  });

  const decisionIdBySourceKey = new Map<string, string>();
  for (const decision of decisions) {
    if (decision.sourceKey) {
      decisionIdBySourceKey.set(decision.sourceKey, decision.id);
    }
  }

  for (const entry of entries) {
    const fromDecisionId = decisionIdBySourceKey.get(entry.uniqueSolrKey);
    if (!fromDecisionId) continue;

    await prisma.decisionLink.deleteMany({
      where: {
        fromDecisionId,
        linkType: { in: [LinkType.APPEAL, LinkType.RELATED] },
      },
    });

    const linkType = mapLinkType(entry);
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
      await prisma.decisionLink.createMany({
        data,
      });
    }
  }
}

// -------------------------
// Main
// -------------------------

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Please provide the path to the JSON file as an argument.");
    process.exit(1);
  }

  const raw = await fs.readFile(filePath, "utf-8");
  const parsedJson: EuipoInput = rootSchema.parse(JSON.parse(raw));
  const entries = parsedJson.results;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
      accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
    },
  });

  try {
    // Pass 1: decisions + text + provisions
    for (const entry of entries) {
      try {
        await upsertDecisionFromEntry(entry, context);
        console.log(`Saved decision ${entry.caseNumber}`);
      } catch (err) {
        console.warn(`Error importing decision ${entry.caseNumber}:`, err);
      }
    }

    // Pass 2: links
    await syncDecisionLinks(entries);
    console.log("Decision links synced.");
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });