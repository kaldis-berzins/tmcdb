<!-- src/routes/chat/+page.svelte -->
<script lang="ts">
  import { Chat } from '@ai-sdk/svelte';
  import { DefaultChatTransport } from 'ai';
  import SqlResultTable from '../lib/components/SQLResultTable.svelte';

  type SqlRow = Record<string, unknown>;

  type RunSqlOutput = {
    ok: boolean;
    rowCount?: number;
    columns?: string[];
    rows?: SqlRow[];
    error?: string;
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

  function submit() {
    const text = input.trim();
    if (!text) return;

    chat.sendMessage({ text });
    input = '';
  }
</script>

<svelte:head>
  <title>EUIPO Cancellation Database Chat</title>
</svelte:head>

<div class="chat-shell">
  <header>
    <h1>EUIPO Cancellation Database Chat</h1>
    <p>Ask natural-language questions. The assistant will generate SQL and query the database.</p>
  </header>

  <div class="examples">
    <button
      type="button"
      onclick={() => {
        input = 'Count decisions by bad faith outcome and institution.';
        submit();
      }}
    >
      Outcomes by institution
    </button>

    <button
      type="button"
      onclick={() => {
        input = 'Which factors are most common in cancelled bad faith cases?';
        submit();
      }}
    >
      Common factors
    </button>

    <button
      type="button"
      onclick={() => {
        input =
          'Find recent decisions involving C2 knowledge of prior rights and D10 Lindt-type factors.';
        submit();
      }}
    >
      C2 and D10 cases
    </button>
  </div>

  <main class="messages">
    {#each chat.messages as message}
      <article class:assistant={message.role === 'assistant'} class:user={message.role === 'user'}>
        <div class="role">{message.role}</div>

        <div class="content">
          {#each message.parts as part}
            {#if part.type === 'text'}
              <p>{part.text}</p>
            {:else if isRunSqlPart(part)}
              <div class="tool-result">
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

                    <SqlResultTable
                      rows={rows}
                      columns={getColumns(output)}
                      caption={`${output.rowCount ?? rows.length} SQL row(s) returned`}
                    />
                  {:else}
                    <div class="sql-error">
                      SQL error: {output?.error ?? 'Unknown SQL execution error'}
                    </div>
                  {/if}
                {:else if part.state === 'output-error'}
                  <div class="sql-error">
                    SQL tool error: {part.errorText ?? 'Unknown SQL tool error'}
                  </div>
                {/if}
              </div>
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

    {#if chat.error}
      <div class="error">
        {chat.error.message}
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
      <button type="button" onclick={() => chat.stop()}>
        Stop
      </button>
    {/if}
  </form>
</div>

<style>
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
    color: #666;
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .examples button {
    border: 1px solid #ddd;
    background: white;
    border-radius: 999px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 500px;
    border: 1px solid #e5e5e5;
    border-radius: 12px;
    padding: 1rem;
    background: #fafafa;
  }

  article {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 1rem;
    padding: 1rem;
    border-radius: 10px;
  }

  article.user {
    background: #eef6ff;
  }

  article.assistant {
    background: white;
    border: 1px solid #eee;
  }

  .role {
    font-weight: 700;
    text-transform: capitalize;
    color: #555;
  }

  .content p {
    margin-top: 0;
    white-space: pre-wrap;
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
    color: #333;
  }

  .sql-details pre {
    margin-top: 0.5rem;
    padding: 0.75rem;
    background: #f4f4f4;
    border: 1px solid #ddd;
    border-radius: 8px;
    overflow-x: auto;
    font-size: 0.85rem;
  }

  .tool-status {
    color: #666;
    font-style: italic;
  }

  .sql-error {
    color: #b00020;
    background: #ffe8ec;
    border: 1px solid #ffccd5;
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
    border: 1px solid #ccc;
    border-radius: 8px;
  }

  form button {
    padding: 0.8rem 1rem;
    border: 0;
    border-radius: 8px;
    background: #111;
    color: white;
    cursor: pointer;
  }

  form button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    color: #b00020;
    background: #ffe8ec;
    border: 1px solid #ffccd5;
    padding: 1rem;
    border-radius: 8px;
  }
</style>