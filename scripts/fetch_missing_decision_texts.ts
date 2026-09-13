import "dotenv/config";
import { chromium, type BrowserContext } from "playwright";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { prisma } from "../lib/prisma";

const DEFAULT_CASE_NUMBERS = ["T-381/22", "T-383/22", "R1231/2014-4"] as const;
const execFile = promisify(execFileCb);

type TargetDecision = {
  id: string;
  sourceKey: string;
  caseNumber: string;
  textUrl: string | null;
  textLanguage: string | null;
  text: string | null;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function downloadDocumentToString(
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
    const buffer = await readFile(filePath);
    const headerText = buffer.subarray(0, 8).toString("binary");
    const headerHex = buffer.subarray(0, 8).toString("hex");

    if (headerText.startsWith("%PDF-")) {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy();
      }
    }

    if (headerText.startsWith("PK") || filename.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    if (filename.endsWith(".doc") || headerHex === "d0cf11e0a1b11ae1") {
      const { stdout } = await execFile("antiword", [filePath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    }

    throw new Error(`Unsupported file type: ${filename}`);
  } finally {
    await page.close().catch(() => {});
  }
}

function parseCaseNumbers(args: string[]): string[] {
  const values = args.map((arg) => arg.trim()).filter(Boolean);
  return values.length > 0 ? values : [...DEFAULT_CASE_NUMBERS];
}

async function loadTargetDecisions(caseNumbers: string[]): Promise<TargetDecision[]> {
  return prisma.decision.findMany({
    where: {
      caseNumber: { in: caseNumbers },
      text: null,
    },
    orderBy: { caseNumber: "asc" },
    select: {
      id: true,
      sourceKey: true,
      caseNumber: true,
      textUrl: true,
      textLanguage: true,
      text: true,
    },
  });
}

async function findSiblingText(decision: TargetDecision): Promise<string | null> {
  const sibling = await prisma.decision.findFirst({
    where: {
      id: { not: decision.id },
      caseNumber: decision.caseNumber,
      text: { not: null },
    },
    orderBy: { sourceKey: "asc" },
    select: {
      text: true,
    },
  });

  return sibling?.text?.trim() ? sibling.text : null;
}

async function main() {
  const caseNumbers = parseCaseNumbers(process.argv.slice(2));
  const decisions = await loadTargetDecisions(caseNumbers);

  if (decisions.length === 0) {
    console.log(`No decisions found for: ${caseNumbers.join(", ")}`);
    return;
  }

  console.log(`Found ${decisions.length} decision(s) to retry.`);

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

  let success = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const decision of decisions) {
      const siblingText = await findSiblingText(decision);
      if (siblingText) {
        await prisma.decision.update({
          where: { id: decision.id },
          data: {
            text: siblingText,
            citationsProcessed: false,
          },
        });

        success++;
        console.log(
          `[DONE] ${decision.sourceKey} (${decision.caseNumber}) - copied text from sibling row`
        );
        continue;
      }

      if (!decision.textUrl) {
        skipped++;
        console.log(
          `[SKIP] ${decision.sourceKey} (${decision.caseNumber}) - no textUrl`
        );
        continue;
      }

      try {
        const text = await downloadDocumentToString(decision.textUrl, context, {
          timeoutMs: 60000,
        });
        const normalizedText = normalizeWhitespace(text);

        if (!normalizedText) {
          throw new Error("Extracted text is blank");
        }

        await prisma.decision.update({
          where: { id: decision.id },
          data: {
            text,
            citationsProcessed: false,
          },
        });

        success++;
        console.log(
          `[DONE] ${decision.sourceKey} (${decision.caseNumber}) - saved ${text.length} chars (${decision.textLanguage ?? "unknown"})`
        );
      } catch (error) {
        failed++;
        console.error(
          `[FAIL] ${decision.sourceKey} (${decision.caseNumber})`,
          error
        );
      }
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log(
    `Finished retry run. Success=${success}, Skipped=${skipped}, Failed=${failed}`
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
