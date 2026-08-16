<!-- src/lib/components/SqlResultTable.svelte -->
<script lang="ts">
  export let rows: Record<string, unknown>[] = [];
  export let columns: string[] | undefined = undefined;
  export let caption: string | undefined = undefined;

  $: visibleColumns =
    columns && columns.length > 0
      ? columns
      : rows[0]
        ? Object.keys(rows[0])
        : [];

  function formatValue(value: unknown) {
    if (value === null || value === undefined) return '';

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    return String(value);
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
              <td>{formatValue(row[column])}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .table-wrapper {
    overflow-x: auto;
    margin: 1rem 0;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.9rem;
  }

  th,
  td {
    border: 1px solid #ddd;
    padding: 0.5rem;
    vertical-align: top;
  }

  th {
    background: #f5f5f5;
    text-align: left;
  }

  caption {
    text-align: left;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }
</style>