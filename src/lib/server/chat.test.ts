import test from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV4 } from 'ai/test';
import { simulateReadableStream } from 'ai';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { createChatResponse } from './chat';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const request = (text: string) => new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text }] }] }) });
function stream(chunks: LanguageModelV4StreamPart[]) { return { stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }) }; }
const finish = (tools = false): LanguageModelV4StreamPart => ({ type: 'finish', usage, finishReason: { unified: tools ? 'tool-calls' : 'stop', raw: tools ? 'tool_calls' : 'stop' } });

test('tool exhaustion reserves a tools-disabled final step and produces a fallback', async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    calls++;
    if (options.toolChoice?.type === 'none') return stream([finish()]);
    return stream([{ type: 'tool-call', toolCallId: `tool-${calls}`, toolName: 'resolveCase', input: JSON.stringify({ query: `CeramTec ${calls}` }) }, finish(true)]);
  } });
  const body = await (await createChatResponse(request('Find decisions citing CeramTec'), model)).text();
  assert.equal(calls, 8);
  assert.equal(model.doStreamCalls[7]?.toolChoice?.type, 'none');
  assert.match(body, /data-search-status/);
  assert.match(body, /citation search was not completed/);
  assert.match(body, /fallback-summary/);
});

test('stream errors produce an application status and close unfinished text', async () => {
  const model = new MockLanguageModelV4({ doStream: async () => stream([{ type: 'text-start', id: 'incomplete' }, { type: 'text-delta', id: 'incomplete', delta: 'Searching' }, { type: 'error', error: new Error('provider unavailable') }]) });
  const body = await (await createChatResponse(request('Search citations'), model)).text();
  assert.match(body, /"type":"text-end","id":"incomplete"/);
  assert.match(body, /"status":"failed"/);
  assert.match(body, /Response generation was interrupted/);
});

test('the model cannot silently choose one of the ambiguous Raimund authorities', async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    calls++;
    return calls === 1 ? stream([{ type: 'tool-call', toolCallId: 'pick', toolName: 'resolveCase', input: JSON.stringify({ query: 'Raimund Schmitt' }) }, finish(true)]) : stream([finish()]);
  } });
  const body = await (await createChatResponse(request('Find all decisions citing Raimund'), model)).text();
  assert.match(body, /"status":"ambiguous"/);
  assert.match(body, /C-425\/16/);
  assert.match(body, /T-56\/15/);
});

test('a model-supplied identifier cannot replace an unknown requested name', async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    calls++;
    return calls === 1 ? stream([{ type: 'tool-call', toolCallId: 'guess', toolName: 'resolveCase', input: JSON.stringify({ query: 'C-17/24' }) }, finish(true)]) : stream([finish()]);
  } });
  const body = await (await createChatResponse(request('Find decisions citing UnconfiguredParty'), model)).text();
  assert.match(body, /"status":"unresolved"/);
  assert.match(body, /Supply a complete case number or ECLI/);
  assert.doesNotMatch(body, /data-citation-result/);
});

test('an explicit numbered reply selects the previously offered authority', async () => {
  const { resolveCase } = await import('../citations/authorities');
  let calls = 0;
  const model = new MockLanguageModelV4({ doStream: async () => {
    calls++;
    return calls === 1 ? stream([{ type: 'tool-call', toolCallId: 'resolve', toolName: 'resolveCase', input: JSON.stringify({ query: 'Raimund' }) }, finish(true)]) : stream([finish()]);
  } });
  const input = new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [
    { id: 'question', role: 'user', parts: [{ type: 'text', text: 'Find decisions citing Raimund' }] },
    { id: 'choices', role: 'assistant', parts: [{ type: 'text', text: 'Choose an authority.' }, { type: 'data-case-resolution', data: resolveCase('Raimund') }] },
    { id: 'selection', role: 'user', parts: [{ type: 'text', text: '1' }] }
  ] }) });
  const body = await (await createChatResponse(input, model)).text();
  assert.match(body, /"status":"resolved"/);
  assert.match(body, /C-425\/16/);
  assert.doesNotMatch(body, /T-56\/15/);
});
