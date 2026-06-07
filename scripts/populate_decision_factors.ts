import "dotenv/config";
import OpenAI, { toFile } from "openai";
import { FactorCategory } from "../generated/prisma/enums";
import { prisma } from "../lib/prisma";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.1-mini";
const OPENAI_PROMPT_ID = process.env.OPENAI_PROMPT_ID;
const REPROCESS = process.env.REPROCESS === "true";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 30000);

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

if (!OPENAI_PROMPT_ID) {
  throw new Error("Missing OPENAI_PROMPT_ID");
}

type ApiCategory =
  | "conduct"
  | "relationship"
  | "doctrinal"
  | "inference_basis";

type ExtractedTag = {
  tag_id: string;
  tag: string;
  category: ApiCategory;
  evidence: string;
};

type ExtractedResponse = {
  tags: ExtractedTag[];
};

type BatchOutputLine = {
  custom_id: string;
  response?: {
    status_code: number;
    request_id?: string;
    body?: any;
  };
  error?: any;
};

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tags"],
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tag_id", "tag", "category", "evidence"],
        properties: {
          tag_id: { type: "string" },
          tag: { type: "string" },
          category: {
            type: "string",
            enum: ["conduct", "relationship", "doctrinal", "inference_basis"],
          },
          evidence: { type: "string" },
        },
      },
    },
  },
} as const;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTagId(tagId: string): string {
  return tagId.trim().replace(/,+$/, "").toUpperCase();
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function toDbCategory(category: ApiCategory): FactorCategory {
  switch (category) {
    case "conduct":
      return FactorCategory.CONDUCT;
    case "relationship":
      return FactorCategory.RELATIONSHIP;
    case "doctrinal":
      return FactorCategory.DOCTRINAL;
    case "inference_basis":
      return FactorCategory.INFERENCE_BASIS;
    default:
      throw new Error(`Unknown API category: ${category satisfies never}`);
  }
}

function getResponseText(response: any): string {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];

  for (const item of response?.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function validateAndNormalizeTags(
  extracted: ExtractedResponse,
  factorMap: Map<string, { id: string; category: FactorCategory }>
): ExtractedTag[] {
  if (!extracted || !Array.isArray(extracted.tags)) {
    throw new Error("Model output is not in the expected { tags: [] } format");
  }

  const deduped = new Map<string, ExtractedTag>();

  for (const raw of extracted.tags) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid tag object in model output");
    }

    const tag_id = normalizeTagId(String(raw.tag_id ?? ""));
    const tag = String(raw.tag ?? "").trim();
    const category = String(raw.category ?? "").trim() as ApiCategory;
    const evidence = String(raw.evidence ?? "").trim();

    if (!tag_id) {
      throw new Error(`Empty tag_id in model output`);
    }

    if (!tag) {
      throw new Error(`Empty tag label for tag_id ${tag_id}`);
    }

    if (
      category !== "conduct" &&
      category !== "relationship" &&
      category !== "doctrinal" &&
      category !== "inference_basis"
    ) {
      throw new Error(`Invalid category "${category}" for tag_id ${tag_id}`);
    }

    if (!factorMap.has(tag_id)) {
      throw new Error(`Unknown factor ID returned by model: ${tag_id}`);
    }

    const factor = factorMap.get(tag_id)!;
    const expectedCategory = toDbCategory(category);

    if (factor.category !== expectedCategory) {
      throw new Error(
        `Category mismatch for ${tag_id}: model=${category}, db=${factor.category}`
      );
    }

    if (!evidence) {
      throw new Error(`Missing evidence for ${tag_id}`);
    }

    if (wordCount(evidence) > 80) {
      console.warn(
        `Warning: evidence for ${tag_id} exceeds 80 words (${wordCount(
          evidence
        )} words)`
      );
    }

    if (!deduped.has(tag_id)) {
      deduped.set(tag_id, {
        tag_id,
        tag,
        category,
        evidence,
      });
    }
  }

  const tags = [...deduped.values()];

  if (tags.length > 0) {
    const hasRelationship = tags.some((t) => t.category === "relationship");
    const hasInferenceBasis = tags.some(
      (t) => t.category === "inference_basis"
    );

    if (!hasRelationship) {
      throw new Error(
        "Model returned tags but no relationship tag, contrary to prompt requirements"
      );
    }

    if (!hasInferenceBasis) {
      throw new Error(
        "Model returned tags but no inference_basis tag, contrary to prompt requirements"
      );
    }
  }

  return tags;
}

function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function downloadFileText(fileId: string): Promise<string> {
  const response = await openai.files.content(fileId);
  return await response.text();
}

async function loadFactorMap() {
  const factors = await prisma.factor.findMany({
    select: {
      id: true,
      category: true,
    },
  });

  return new Map(
    factors.map((f) => [
      normalizeTagId(f.id),
      { id: f.id, category: f.category },
    ])
  );
}

async function loadTargetDecisions(limit?: number) {
  const whereClause = REPROCESS
    ? { text: { not: null as any } }
    : {
        text: { not: null as any },
        factorsProcessed: false,
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

async function markBlankDecisionsProcessed(
  decisions: {
    id: string;
    sourceKey: string;
    caseNumber: string;
    text: string | null;
  }[]
) {
  for (const decision of decisions) {
    if (!decision.text || !decision.text.trim()) {
      await prisma.decision.update({
        where: { id: decision.id },
        data: { factorsProcessed: true },
      });

      console.log(
        `[SKIP] ${decision.sourceKey} (${decision.caseNumber}) - no text`
      );
    }
  }
}

function buildBatchRequest(decision: {
  id: string;
  text: string;
}) {
  return {
    custom_id: decision.id,
    method: "POST",
    url: "/v1/responses",
    body: {
      model: OPENAI_MODEL,
      prompt: {
        id: OPENAI_PROMPT_ID,
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: decision.text,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "decision_factor_extraction",
          schema: EXTRACTION_JSON_SCHEMA,
          strict: true,
        },
      },
    },
  };
}

async function submitBatch(limit?: number) {
  const decisions = await loadTargetDecisions(limit);
  console.log(
    `Found ${decisions.length} decision(s) to process${
      typeof limit === "number" ? ` (limit=${limit})` : ""
    }`
  );

  await markBlankDecisionsProcessed(decisions);

  const batchable = decisions.filter((d) => d.text && d.text.trim()) as Array<{
    id: string;
    sourceKey: string;
    caseNumber: string;
    text: string;
  }>;

  if (batchable.length === 0) {
    console.log("No decisions with text to submit.");
    return null;
  }

  const jsonl = batchable.map((d) => JSON.stringify(buildBatchRequest(d))).join("\n");

  const uploadedFile = await openai.files.create({
    file: await toFile(
      Buffer.from(jsonl, "utf8"),
      `decision-factor-extraction-${Date.now()}.jsonl`
    ),
    purpose: "batch",
  });

  const batch = await openai.batches.create({
    input_file_id: uploadedFile.id,
    endpoint: "/v1/responses",
    completion_window: "24h",
    metadata: {
      job: "decision-factor-extraction",
      model: OPENAI_MODEL,
      reprocess: String(REPROCESS),
      ...(typeof limit === "number" ? { limit: String(limit) } : {}),
    },
  });

  console.log(`Submitted batch: ${batch.id}`);
  console.log(`Input file: ${uploadedFile.id}`);
  console.log(`Requests submitted: ${batchable.length}`);
  return batch.id;
}

async function getBatch(batchId: string) {
  const batch = await openai.batches.retrieve(batchId);

  const counts = batch.request_counts;
  console.log(
    `Batch ${batch.id}: status=${batch.status}, total=${counts?.total ?? 0}, completed=${counts?.completed ?? 0}, failed=${counts?.failed ?? 0}`
  );

  return batch;
}

async function waitForBatch(batchId: string) {
  while (true) {
    const batch = await getBatch(batchId);

    if (
      batch.status === "completed" ||
      batch.status === "failed" ||
      batch.status === "expired" ||
      batch.status === "cancelled"
    ) {
      return batch;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function applyDecisionFactors(
  decisionId: string,
  tags: ExtractedTag[]
) {
  const rows = tags.map((tag) => ({
    decisionId,
    factorId: tag.tag_id,
    evidence: tag.evidence,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.decisionFactor.deleteMany({
      where: { decisionId },
    });

    if (rows.length > 0) {
      await tx.decisionFactor.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }

    await tx.decision.update({
      where: { id: decisionId },
      data: { factorsProcessed: true },
    });
  });

  return rows.length;
}

async function applyBatch(batchId: string) {
  const factorMap = await loadFactorMap();
  const batch = await openai.batches.retrieve(batchId);

  if (batch.status !== "completed") {
    throw new Error(
      `Batch ${batchId} is not completed. Current status: ${batch.status}`
    );
  }

  if (!batch.output_file_id) {
    throw new Error(`Batch ${batchId} has no output_file_id`);
  }

  const outputText = await downloadFileText(batch.output_file_id);
  const outputLines = parseJsonl<BatchOutputLine>(outputText);

  const decisionIds = [...new Set(outputLines.map((line) => line.custom_id))];

  const decisions = await prisma.decision.findMany({
    where: { id: { in: decisionIds } },
    select: {
      id: true,
      sourceKey: true,
      caseNumber: true,
    },
  });

  const decisionMap = new Map(decisions.map((d) => [d.id, d]));

  let success = 0;
  let failed = 0;

  for (const line of outputLines) {
    const decision = decisionMap.get(line.custom_id);

    if (!decision) {
      failed++;
      console.error(`[FAIL] Unknown decision for custom_id=${line.custom_id}`);
      continue;
    }

    if (line.error) {
      failed++;
      console.error(
        `[FAIL] ${decision.sourceKey} (${decision.caseNumber})`,
        line.error
      );
      continue;
    }

    const statusCode = line.response?.status_code ?? 0;
    if (statusCode < 200 || statusCode >= 300) {
      failed++;
      console.error(
        `[FAIL] ${decision.sourceKey} (${decision.caseNumber}) - HTTP ${statusCode}`,
        line.response?.body
      );
      continue;
    }

    try {
      const responseBody = line.response?.body;
      const rawText = getResponseText(responseBody);

      if (!rawText) {
        throw new Error("OpenAI returned empty output_text");
      }

      const extracted = JSON.parse(rawText) as ExtractedResponse;
      const tags = validateAndNormalizeTags(extracted, factorMap);
      const count = await applyDecisionFactors(decision.id, tags);

      success++;
      console.log(
        `[DONE] ${decision.sourceKey} (${decision.caseNumber}) - ${count} factors`
      );
    } catch (err) {
      failed++;
      console.error(
        `[FAIL] ${decision.sourceKey} (${decision.caseNumber})`,
        err
      );
    }
  }

  if (batch.error_file_id) {
    const errorText = await downloadFileText(batch.error_file_id);
    const errorLines = parseJsonl<any>(errorText);

    for (const errLine of errorLines) {
      const decision = decisionMap.get(errLine.custom_id);
      failed++;

      if (decision) {
        console.error(
          `[FAIL] ${decision.sourceKey} (${decision.caseNumber})`,
          errLine.error ?? errLine
        );
      } else {
        console.error(`[FAIL] custom_id=${errLine.custom_id}`, errLine.error ?? errLine);
      }
    }
  }

  console.log(`Finished applying batch ${batchId}. Success=${success}, Failed=${failed}`);
}

async function main() {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  if (!command || !["submit", "status", "apply", "run"].includes(command)) {
    console.log(`
Usage:
  tsx script.ts submit [--limit 100]
  tsx script.ts status <batch_id>
  tsx script.ts apply <batch_id>
  tsx script.ts run [--limit 100]
`);
    process.exit(1);
  }

  if (command === "submit") {
    const limit = parseLimitArg(args);
    await submitBatch(limit);
    return;
  }

  if (command === "status") {
    const batchId = args[0];
    if (!batchId) {
      throw new Error("Missing batch_id");
    }
    await getBatch(batchId);
    return;
  }

  if (command === "apply") {
    const batchId = args[0];
    if (!batchId) {
      throw new Error("Missing batch_id");
    }
    await applyBatch(batchId);
    return;
  }

  if (command === "run") {
    const limit = parseLimitArg(args);
    const batchId = await submitBatch(limit);
    if (!batchId) {
      console.log("Nothing to do.");
      return;
    }
    const batch = await waitForBatch(batchId);
    if (batch.status !== "completed") {
      throw new Error(`Batch ${batchId} finished with status ${batch.status}`);
    }
    await applyBatch(batchId);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });