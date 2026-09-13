<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onMount, tick } from 'svelte';

  export let value = '';

  const dispatch = createEventDispatcher<{
    open: { value: string };
  }>();

  let previewEl: HTMLSpanElement | undefined;
  let isOverflowing = false;

  async function updateOverflow() {
    await tick();

    if (!previewEl) return;

    const overflowsHorizontally = previewEl.scrollWidth > previewEl.clientWidth + 1;
    const overflowsVertically = previewEl.scrollHeight > previewEl.clientHeight + 1;

    isOverflowing = overflowsHorizontally || overflowsVertically;
  }

  $: if (value) {
    updateOverflow();
  } else {
    isOverflowing = false;
  }

  function openPopup() {
    dispatch('open', { value });
  }

  onMount(() => {
    updateOverflow();

    if (!previewEl || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateOverflow();
    });

    observer.observe(previewEl);

    return () => observer.disconnect();
  });
</script>

{#if isOverflowing}
  <button class="expandable-cell" type="button" title={value} on:click={openPopup}>
    <span class="preview-text-wrap">
      <span bind:this={previewEl} class="preview-text">{value}</span>
      <span class="expand-hint">Show full</span>
    </span>
  </button>
{:else}
  <span bind:this={previewEl} class="plain-text">{value}</span>
{/if}

<style>
  .expandable-cell {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    font: inherit;
  }

  .preview-text-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .preview-text,
  .plain-text {
    display: -webkit-box;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  .expand-hint {
    font-size: 0.75rem;
    font-weight: 600;
    color: #a5b4fc;
  }

  .expandable-cell:hover .expand-hint,
  .expandable-cell:focus-visible .expand-hint {
    color: #c7d2fe;
  }

  .expandable-cell:focus-visible {
    outline: 2px solid #a5b4fc;
    outline-offset: 2px;
  }
</style>
