import { openai } from '@ai-sdk/openai';
import { type LanguageModel, convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse, streamText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { runReadOnlySql } from './sql';
import { classifyQueryError, QueryValidationError } from './read-only';
import { resolveCase } from '../citations/authorities';
import { findCitingDecisions } from './citation-search';
import { citationSummary, mergeCitationPages } from '../citations/presentation';
import type { CitationSearchResult, CaseResolution } from '../citations/types';
import { DATABASE_SCHEMA_PROMPT } from './db-schema-prompt';

export async function createChatResponse(request: Request, model: LanguageModel = openai('gpt-5.5')) {
  const { messages } = await request.json();
  const latestUser = [...messages].reverse().find((message) => message.role === 'user');
  const userText = latestUser?.parts?.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join(' ') ?? '';
  let userResolution = resolveCase(userText);
  const latestResolution = [...messages].reverse().flatMap((message) => message.parts ?? []).find((part) => part.type === 'data-case-resolution');
  const selection = /^(?:the\s+)?(first|second|\d+)(?:\s+one)?[.!]?$/i.exec(userText.trim());
  if (userResolution.status === 'unresolved' && latestResolution?.data?.status === 'ambiguous' && selection) {
    const choice = selection[1]!.toLowerCase();
    const index = choice === 'first' ? 0 : choice === 'second' ? 1 : Number(choice) - 1;
    const authority = latestResolution.data.candidates[index];
    if (authority) userResolution = resolveCase(authority.ecli ?? authority.caseNumber ?? '');
  }
  // Follow-ups can reuse a previously displayed authority, but an unknown new
  // name must never be replaced by an identifier invented in tool arguments.
  if (userResolution.status === 'unresolved' && /^(?:please\s+)?(?:continue|more|next|show (?:me )?more|get (?:the )?remaining)\b/i.test(userText)) {
    const previous = [...messages].reverse().flatMap((message) => message.parts ?? []).find((part) => part.type === 'data-citation-result');
    if (previous?.data?.target) userResolution = resolveCase(previous.data.target.ecli ?? previous.data.target.caseNumber ?? '');
  }
  let selectedKey: string | undefined;
  let resolution: CaseResolution | undefined;
  let accumulated: CitationSearchResult | undefined;
  let toolCalls = 0;
  let modelSteps = 0;
  let sqlSuccesses = 0;
  let streamFailed = false;
  let finalText = '';
  let citationWorkflow = /\b(cit(?:e[sd]?|ing|ations?))\b/i.test(userText) && (userResolution.candidates.length > 0 || /\b(?:decisions?|cases?)\b.*\bcit(?:e[sd]?|ing)\b|\bcitations? (?:to|of)\b/i.test(userText));
  const failures = new Map<string, string>();
  const attempts = new Map<string, number>();

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      async function execute<T>(scope: string, operation: () => Promise<T>) {
        toolCalls++;
        const attempt = (attempts.get(scope) ?? 0) + 1;
        attempts.set(scope, attempt);
        try {
          if (toolCalls > 12 || attempt > 2) throw new QueryValidationError('The query budget is exhausted. Summarize the available results and unresolved checks.');
          if (request.signal.aborted) throw new QueryValidationError('The request was interrupted.');
          const output = await operation();
          failures.delete(scope);
          return output;
        } catch (error) {
          const failure = classifyQueryError(error);
          failures.set(scope, failure.error);
          console.info('chat_tool_failure', { kind: failure.kind, toolCalls });
          return failure;
        }
      }
      try {
        const result = streamText({
          model,
          abortSignal: request.signal,
          system: `You are a legal database research assistant for an EUIPO trademark cancellation database.
For questions about decisions citing a named authority, call resolveCase with the user's wording, then findCitingDecisions with the returned key. Never substitute another case or use runSql to bypass an ambiguous or unresolved identity. Ask the user to choose if resolution is ambiguous. Keep the selected authority fixed across retries.
For other analytical questions, use read-only runSql with quoted PostgreSQL identifiers and the supplied schema. Never invent decisions, identifiers, dates, URLs or outcomes. Include sourceKey, caseNumber, date, institution and d."url" AS "decisionUrl" for individual decisions.
Citation results distinguish verified decisions from case-only candidates. Never count the latter as citations to a particular judgment. Only total is an exhaustive verified count for the completed stored-collection search. hasMore means continuation is needed. For requests for all, continue with nextCursor within the tool budget; otherwise explicitly state that the user can continue in the results panel.
A timeout is an incomplete check, not an empty result. Retry an identical citation target/cursor at most once; never broaden it to make a query succeed. Correct syntax errors when appropriate. State unresolved failures. Generic SQL completeness is always unknown, including when rows are fewer than the outer cap.
Do not render result tables in Markdown or plain text: the application displays them. Give a concise final explanation of verified results, uncertainty, pagination and corpus coverage. If tools are unavailable, summarize the available state and missing checks. For evidence, return passages surrounding the match; document openings are not citation evidence.
${DATABASE_SCHEMA_PROMPT}`,
          messages: await convertToModelMessages(messages),
          tools: {
            resolveCase: tool({
              description: 'Resolve an authority name, complete case number or ECLI. Ambiguity requires user selection; a name fragment is not proof.',
              inputSchema: z.object({ query: z.string().min(1).max(500) }),
              execute: ({ query }) => execute('resolve:' + query, async () => {
                citationWorkflow = true;
                // The model cannot silently disambiguate a name the user left ambiguous.
                resolution = userResolution;
                if (selectedKey && !resolution.candidates.some((candidate) => candidate.key === selectedKey)) throw new QueryValidationError('The selected authority cannot change during this search.');
                if (resolution.status === 'resolved') selectedKey = resolution.candidates[0]!.key;
                writer.write({ type: 'data-case-resolution', id: 'case-resolution', data: resolution });
                return resolution;
              })
            }),
            findCitingDecisions: tool({
              description: 'Find direct citations with exact reference validation, distinct decisions, evidence and stable pagination. Requires successful case resolution.',
              inputSchema: z.object({ key: z.string(), cursor: z.string().optional(), pageSize: z.number().int().min(1).max(100).default(25) }),
              execute: ({ key, cursor, pageSize }) => execute(`citations:${key}:${cursor ?? ''}`, async () => {
                if (key !== selectedKey) throw new QueryValidationError('Resolve the authority first. An ambiguous name requires user selection.');
                const output = await findCitingDecisions(key, { ...(cursor ? { cursor } : {}), pageSize });
                accumulated = mergeCitationPages(cursor ? accumulated : undefined, output);
                writer.write({ type: 'data-citation-result', id: 'citation-result', data: accumulated });
                return output;
              })
            }),
            runSql: tool({
              description: 'Read-only PostgreSQL SELECT/WITH for general analysis. Use the dedicated tools for incoming citation searches.',
              inputSchema: z.object({ sql: z.string(), maxRows: z.number().int().min(1).max(500).default(100) }),
              execute: ({ sql, maxRows }) => execute('sql:' + sql, async () => {
                if (citationWorkflow) throw new QueryValidationError('Use the dedicated citation workflow for this search.');
                const output = await runReadOnlySql(sql, maxRows);
                sqlSuccesses++;
                return { ok: true, ...output };
              })
            })
          },
          prepareStep: ({ stepNumber }) => {
            if (stepNumber >= 7 || toolCalls >= 12 || (resolution && resolution.status !== 'resolved')) return { toolChoice: 'none', activeTools: [] };
            if (stepNumber === 0 && citationWorkflow) return { toolChoice: { type: 'tool', toolName: 'resolveCase' } };
            if (stepNumber === 1 && selectedKey) return { toolChoice: { type: 'tool', toolName: 'findCitingDecisions' } };
            return {};
          },
          stopWhen: stepCountIs(8),
          onStepEnd: ({ text, toolCalls: calls, finishReason }) => {
            modelSteps++;
            finalText = calls.length ? '' : text;
            console.info('chat_step', { modelSteps, toolCalls, finishReason, searchStatus: accumulated?.status ?? resolution?.status ?? 'none' });
          },
          onError: () => { streamFailed = true; console.error('chat_stream_failure', { modelSteps, toolCalls }); }
        });
        const reader = result.toUIMessageStream({ sendFinish: false, onError: () => 'Response generation failed.' }).getReader();
        const openTexts = new Set<string>();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === 'error' || value.type === 'abort') { streamFailed = true; continue; }
            if (value.type === 'text-start') openTexts.add(value.id);
            if (value.type === 'text-end') openTexts.delete(value.id);
            writer.write(value);
          }
        } finally {
          for (const id of openTexts) writer.write({ type: 'text-end', id });
          reader.releaseLock();
        }
      } catch {
        streamFailed = true;
        console.error('chat_generation_failure', { modelSteps, toolCalls });
      }
      const outstanding = [...failures.values()];
      const summary = accumulated ? citationSummary(accumulated)
        : resolution ? resolution.status === 'resolved' ? 'The authority was resolved, but its citation search was not completed.' : resolution.explanation
        : sqlSuccesses ? `${sqlSuccesses} SQL query result(s) available. Exhaustiveness has not been established.`
        : 'No database search was completed.';
      const message = `${summary}${outstanding.length ? ' Unresolved checks: ' + [...new Set(outstanding)].join(' ') : ''}${streamFailed ? ' Response generation was interrupted; the displayed results remain available.' : ''}`;
      writer.write({ type: 'data-search-status', id: 'search-status', data: { message, status: outstanding.length || streamFailed ? accumulated || sqlSuccesses ? 'partial' : 'failed' : accumulated?.status ?? (resolution?.status === 'resolved' ? 'partial' : resolution?.status) ?? 'finished' } });
      if (!finalText.trim() || streamFailed) {
        writer.write({ type: 'text-start', id: 'fallback-summary' });
        writer.write({ type: 'text-delta', id: 'fallback-summary', delta: message });
        writer.write({ type: 'text-end', id: 'fallback-summary' });
      }
      writer.write({ type: 'finish' });
    },
    onError: () => 'The response was interrupted. Any displayed results remain usable, but search completion is unconfirmed.'
  });
  return createUIMessageStreamResponse({ stream });
}
