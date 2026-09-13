<!-- src/lib/components/SqlResultTable.svelte -->
<script lang="ts">
  import ExpandableTableCell from './ExpandableTableCell.svelte';

  export let rows: Record<string, unknown>[] = [];
  export let columns: string[] | undefined = undefined;
  export let caption: string | undefined = undefined;

  let popupValue = '';
  let popupOpen = false;

  function columnKey(column: string) {
    return column.replace(/[^a-z0-9]/gi, '').toLowerCase();
  }

  function orderColumns(columns: string[]) {
    const displayColumns = columns.filter((column) => columnKey(column) !== 'sourcekey');
    const priorityGroups = [
      ['url', 'decisionurl'],
      ['trademarkname'],
      ['casenumber']
    ];

    const prioritized = priorityGroups.flatMap((keys) =>
      displayColumns.filter((column) => keys.includes(columnKey(column)))
    );
    const prioritizedColumns = new Set(prioritized);

    return [...prioritized, ...displayColumns.filter((column) => !prioritizedColumns.has(column))];
  }

  $: visibleColumns = orderColumns(
    columns && columns.length > 0
      ? columns
      : rows[0]
        ? Object.keys(rows[0])
        : []
  );

  function formatValue(value: unknown) {
    if (value === null || value === undefined) return '';

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
  }

  function getDecisionUrl(column: string, value: unknown): string | undefined {
    if (!['url', 'decisionurl'].includes(columnKey(column)) || typeof value !== 'string') {
      return undefined;
    }

    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  function openTextPopup(value: string) {
    popupValue = value;
    popupOpen = true;
  }

  function closeTextPopup() {
    popupOpen = false;
  }
</script>

{#if rows.length === 0}
  <p>No rows returned.</p>
{:else}
  <div class="table-wrapper">
    <table>
      {#if caption}
        <caption>{caption}</caption>
      {/if}

      <thead>
        <tr>
          {#each visibleColumns as column}
            <th>{column}</th>
          {/each}
        </tr>
      </thead>

      <tbody>
        {#each rows as row}
          <tr>
            {#each visibleColumns as column}
              {@const decisionUrl = getDecisionUrl(column, row[column])}
              <td>
                {#if decisionUrl}
                  <a
                    class="decision-link"
                    href={decisionUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open decision"
                    title="Open decision"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M14 3h7v7m0-7-10 10" />
                      <path d="M11 5H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" />
                    </svg>
                  </a>
                {:else}
                  <ExpandableTableCell
                    value={formatValue(row[column])}
                    on:open={(event) => openTextPopup(event.detail.value)}
                  />
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if popupOpen}
    <div class="text-popup-layer">
      <button
        class="text-popup-backdrop"
        type="button"
        aria-label="Close full text popup"
        on:click={closeTextPopup}
      ></button>

      <div
        class="text-popup"
        role="dialog"
        aria-modal="true"
        aria-label="Full cell text"
        tabindex="-1"
      >
        <button class="close-popup" type="button" on:click={closeTextPopup}>Close</button>
        <pre>{popupValue}</pre>
      </div>
    </div>
  {/if}
{/if}

<style>
  .table-wrapper {
    max-width: 100%;
    max-height: min(60vh, 32rem);
    overflow: auto;
    overscroll-behavior: contain;
    margin: 1rem 0;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }

  th,
  td {
    border: 1px solid #374151;
    padding: 0.5rem;
    vertical-align: top;
  }

  th {
    background: #374151;
    text-align: left;
  }

  .decision-link {
    display: inline-flex;
    padding: 0.25rem;
    color: #a5b4fc;
    border-radius: 0.25rem;
  }

  .decision-link:hover,
  .decision-link:focus-visible {
    color: #c7d2fe;
    background: #312e81;
  }

  .decision-link svg {
    width: 1rem;
    height: 1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .text-popup-layer {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
  }

  .text-popup-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgb(3 7 18 / 0.72);
    cursor: pointer;
  }

  .text-popup {
    position: relative;
    width: min(42rem, 100%);
    max-height: min(75vh, 48rem);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid #374151;
    border-radius: 0.75rem;
    background: #111827;
    box-shadow: 0 24px 80px rgb(0 0 0 / 0.45);
  }

  .text-popup pre {
    margin: 0;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    font: inherit;
    color: #e5e7eb;
  }

  .close-popup {
    align-self: flex-end;
    border: 1px solid #4b5563;
    border-radius: 0.5rem;
    background: #1f2937;
    color: #e5e7eb;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
    font: inherit;
  }

  .close-popup:hover,
  .close-popup:focus-visible {
    background: #374151;
  }

  caption {
    text-align: left;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
</style>
