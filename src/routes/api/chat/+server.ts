// src/routes/api/chat/+server.ts
import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  tool
} from 'ai';
import { z } from 'zod';
import { runReadOnlySql } from '../../../lib/server/sql';
import { DATABASE_SCHEMA_PROMPT } from '../../../lib/server/db-schema-prompt';

export async function POST({ request }) {
  const { messages } = await request.json();

  const result = streamText({
    model: openai('gpt-5.5'),

    system: `
You are a legal database research assistant for an EUIPO trademark cancellation database.

You can answer questions by writing PostgreSQL SQL and executing it with the runSql tool.

Rules:
- Prefer to use runSql for factual database questions.
- Generate PostgreSQL SQL using the provided schema.
- Use quoted identifiers, e.g. "Decision", "caseNumber", "badFaithOutcome".
- Never invent decisions, case numbers, dates, citations, or outcomes.
- When presenting results, cite concrete fields like "sourceKey", "caseNumber", "date", "institution", and "badFaithOutcome".
- If the SQL result is empty, say no matching records were found.
- For broad analytical questions, use aggregate SQL first, then if useful run a second query to retrieve examples.
- For text fields, return snippets using LEFT("text", n), not the entire text, unless specifically asked.
- If you encounter a SQL error, correct the SQL and try again.

${DATABASE_SCHEMA_PROMPT}
`,

    messages: await convertToModelMessages(messages),

    tools: {
      runSql: tool({
        description:
          'Execute a read-only PostgreSQL SELECT/WITH query against the EUIPO trademark cancellation database.',
        inputSchema: z.object({
          sql: z
            .string()
            .describe(
              'A single read-only PostgreSQL SELECT or WITH query. Use quoted identifiers.'
            ),
          maxRows: z
            .number()
            .int()
            .min(1)
            .max(500)
            .default(100)
            .describe('Maximum rows to return.')
        }),
        execute: async ({ sql, maxRows }) => {
          try {
            const rows = await runReadOnlySql(sql, maxRows);

            return {
              ok: true,
              rowCount: rows.length,
              rows
            };
          } catch (error) {
            return {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Unknown SQL execution error'
            };
          }
        }
      })
    },

    stopWhen: stepCountIs(8)
  });

  return result.toUIMessageStreamResponse();
}