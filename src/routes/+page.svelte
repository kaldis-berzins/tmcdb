<!-- src/routes/chat/+page.svelte -->
<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { DefaultChatTransport } from 'ai';
  import MarkdownText from '$lib/components/MarkdownText.svelte';
  import SqlResultTable from '../lib/components/SQLResultTable.svelte';

  import CitationSearchResults from '../lib/components/CitationSearchResults.svelte';
  import type { CitationSearchResult, CaseResolution, Authority } from '../lib/citations/types';

  function dataPart(part: unknown): { type: string; data: unknown } | undefined {
    return part && typeof part === 'object' && 'type' in part && 'data' in part ? part as { type: string; data: unknown } : undefined;
  }
  function chooseAuthority(authority: Authority) {
    interrupted = false;
    chat.sendMessage({ text: `Use ${authority.title} (${authority.caseNumber ?? ''}; ${authority.ecli ?? ''}) as the intended authority for my previous citation search.` });
  }

  type SqlRow = Record<string, unknown>;

  type RunSqlOutput = {
    ok: boolean;
    rowCount?: number;
    columns?: string[];
    rows?: SqlRow[];
    error?: string;
    truncated?: boolean;
    limitation?: string;
  };

  type RunSqlToolPart = {
    type: 'tool-runSql';
    state?: string;
    input?: {
      sql?: string;
      maxRows?: number;
    };
    output?: RunSqlOutput;
    errorText?: string;
  };

  function isRunSqlPart(part: unknown): part is RunSqlToolPart {
    return (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      (part as { type?: unknown }).type === 'tool-runSql'
    );
  }

  function getRows(output: RunSqlOutput | undefined): SqlRow[] {
    return Array.isArray(output?.rows) ? output.rows : [];
  }

  function getColumns(output: RunSqlOutput | undefined): string[] | undefined {
    return Array.isArray(output?.columns) ? output.columns : undefined;
  }

  const chat = new Chat({
    transport: new DefaultChatTransport({
      api: '/api/chat'
    })
  });

  let input = $state('');
  let interrupted = $state(false);

  function submit() {
    const text = input.trim();
    if (!text) return;

    interrupted = false;
    chat.sendMessage({ text });
    input = '';
  }
</script>

<svelte:head>
  <title>EUIPO Cancellation Database Chat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
    rel="stylesheet"
  />
</svelte:head>

<div class="chat-shell">
  <header>
    <h1>TMCDB</h1>
    <p>Search decisions, verify citations, and explore the trademark cancellation database.</p>
  </header>

  <main class="messages">
    {#each chat.messages as message}
      <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'}>
        <div class="role">{message.role}</div>

        <div class="content">
          {#each message.parts as part}
            {#if part.type === 'text'}
              {#if message.role === 'assistant'}
                <MarkdownText text={part.text} />
              {:else}
                <p>{part.text}</p>
              {/if}
            {:else if dataPart(part)?.type === 'data-citation-result'}
              <CitationSearchResults result={dataPart(part)!.data as CitationSearchResult} />
            {:else if dataPart(part)?.type === 'data-case-resolution'}
              {@const resolution = dataPart(part)!.data as CaseResolution}
              {#if resolution.status !== 'resolved'}
                <p>{resolution.explanation}</p>
                {#each resolution.candidates as authority}
                  <button type="button" disabled={chat.status === 'streaming' || chat.status === 'submitted'} onclick={() => chooseAuthority(authority)}>{authority.title} · {authority.caseNumber}</button>
                {/each}
              {/if}
            {:else if dataPart(part)?.type === 'data-search-status'}
              {@const status = dataPart(part)!.data as { message: string; status: string }}
              <details class="sql-details"><summary>Search status: {status.status}</summary><p>{status.message}</p></details>
            {:else if isRunSqlPart(part)}
              <details class="tool-result"><summary>Exploratory SQL result</summary>
                {#if part.input?.sql}
                  <details class="sql-details">
                    <summary>SQL query</summary>
                    <pre>{part.input.sql}</pre>
                  </details>
                {/if}

                {#if part.state === 'input-streaming' || part.state === 'input-available'}
                  <p class="tool-status">Running SQL query…</p>
                {:else if part.state === 'output-available'}
                  {@const output = part.output}

                  {#if output?.ok}
                    {@const rows = getRows(output)}

                    {#if output.truncated}<p>Output truncated at {output.rowCount} rows.</p>{/if}
                    <p class="tool-status">{output.limitation ?? 'Exploratory result; completeness is not established.'}</p>
                    <SqlResultTable
                      rows={rows}
                      columns={getColumns(output)}
                      caption={`${output.rowCount ?? rows.length} SQL row(s) returned`}
                    />
                  {:else}
                    <div class="sql-error">
                      SQL error: {output?.error?.trim() || 'Unknown SQL execution error'}
                    </div>
                  {/if}
                {:else if part.state === 'output-error'}
                  <div class="sql-error">
                    SQL tool error: {part.errorText?.trim() || 'Unknown SQL tool error'}
                  </div>
                {/if}
              </details>
            {/if}
          {/each}
        </div>
      </article>
    {/each}

    {#if chat.status === 'submitted' || chat.status === 'streaming'}
      <article class="assistant">
        <div class="role">assistant</div>
        <div class="content">
          <p>Thinking…</p>
        </div>
      </article>
    {/if}

    {#if interrupted && chat.status !== 'streaming' && chat.status !== 'submitted'}
      <p role="status">Response stopped. Displayed results remain available; search completion is unconfirmed. Use Continue search where available.</p>
    {/if}

    {#if chat.error}
      <div class="error">
        {chat.error.message?.trim() || 'Unable to complete the response. Please try again.'} Any displayed results remain usable; search completion is unconfirmed.
      </div>
    {/if}
  </main>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <input
      bind:value={input}
      placeholder="Ask about decisions, factors, citations, provisions..."
      disabled={chat.status === 'submitted' || chat.status === 'streaming'}
    />

    <button
      type="submit"
      disabled={!input.trim() || chat.status === 'submitted' || chat.status === 'streaming'}
    >
      Send
    </button>

    {#if chat.status === 'streaming'}
      <button type="button" onclick={() => { interrupted = true; chat.stop(); }}>
        Stop
      </button>
    {/if}
  </form>
</div>

<style>
  :global(body) {
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin: 0;
    background: #111827;
    color: #e5e7eb;
    color-scheme: dark;
  }

  .chat-shell {
    max-width: 950px;
    margin: 0 auto;
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header h1 {
    margin-bottom: 0.25rem;
  }

  header p {
    color: #9ca3af;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 500px;
    border: 1px solid #374151;
    border-radius: 12px;
    padding: 1rem;
    background: #1f2937;
  }

  article {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 1rem;
    padding: 1rem;
    border-radius: 10px;
    min-width: 0;
  }

  article.user {
    background: #1e3a5f;
  }

  article.assistant {
    background: #111827;
    border: 1px solid #374151;
  }

  .role {
    font-weight: 700;
    text-transform: capitalize;
    color: #a5b4fc;
  }

  .content p {
    margin-top: 0;
    white-space: pre-wrap;
  }

  .content {
    min-width: 0;
  }

  .tool-result {
    margin-top: 0.75rem;
  }

  .sql-details {
    margin: 0.75rem 0;
  }

  .sql-details summary {
    cursor: pointer;
    font-weight: 600;
    color: #e5e7eb;
  }

  .sql-details pre {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: #030712;
    border: 1px solid #374151;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 0.85rem;
  }

  .tool-status {
    color: #9ca3af;
    font-style: italic;
  }

  .sql-error {
    color: #fecaca;
    background: #450a0a;
    border: 1px solid #991b1b;
    padding: 0.75rem;
    border-radius: 8px;
    margin-top: 0.5rem;
  }

  form {
    display: flex;
    gap: 0.5rem;
  }

  input {
    flex: 1;
    padding: 0.8rem 1rem;
    border: 1px solid #4b5563;
    border-radius: 8px;
    background: #1f2937;
    color: #f9fafb;
  }

  form button {
    padding: 0.8rem 1rem;
    border: 0;
    border-radius: 8px;
    background: #4f46e5;
    color: #fff;
    cursor: pointer;
  }

  form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: #fecaca;
    background: #450a0a;
    border: 1px solid #991b1b;
    padding: 1rem;
    border-radius: 8px;
  }
</style>
