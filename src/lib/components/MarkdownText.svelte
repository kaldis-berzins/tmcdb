<script lang="ts">
  import { renderMarkdown } from '$lib/markdown';

  let { text } = $props<{ text: string }>();
</script>

<div class="markdown">
  {@html renderMarkdown(text)}
</div>

<style>
  .markdown {
    min-width: 0;
  }

  .markdown :global(*) {
    overflow-wrap: anywhere;
  }

  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(blockquote),
  .markdown :global(pre),
  .markdown :global(table),
  .markdown :global(hr) {
    margin: 0 0 0.9rem;
  }

  .markdown :global(p:last-child),
  .markdown :global(ul:last-child),
  .markdown :global(ol:last-child),
  .markdown :global(blockquote:last-child),
  .markdown :global(pre:last-child),
  .markdown :global(table:last-child),
  .markdown :global(hr:last-child) {
    margin-bottom: 0;
  }

  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) {
    margin: 0 0 0.75rem;
    line-height: 1.25;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    padding-left: 1.35rem;
  }

  .markdown :global(li + li) {
    margin-top: 0.25rem;
  }

  .markdown :global(li > ul),
  .markdown :global(li > ol) {
    margin-top: 0.25rem;
  }

  .markdown :global(.task-list-item) {
    list-style: none;
  }

  .markdown :global(.task-list-item-checkbox) {
    margin: 0 0.4rem 0 -1.2rem;
  }

  .markdown :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }

  .markdown :global(th),
  .markdown :global(td) {
    padding: 0.5rem 0.75rem;
    border: 1px solid #374151;
    text-align: left;
    vertical-align: top;
  }

  .markdown :global(th) {
    background: rgba(148, 163, 184, 0.12);
  }

  .markdown :global(hr) {
    border: 0;
    border-top: 1px solid #374151;
  }

  .markdown :global(img) {
    max-width: 100%;
    height: auto;
  }

  .markdown :global(a) {
    color: #93c5fd;
  }

  .markdown :global(blockquote) {
    padding-left: 0.9rem;
    border-left: 3px solid #4b5563;
    color: #cbd5e1;
  }

  .markdown :global(code) {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 0.9em;
    background: rgba(148, 163, 184, 0.12);
    border-radius: 6px;
    padding: 0.15rem 0.35rem;
  }

  .markdown :global(pre) {
    overflow-x: auto;
    padding: 0.85rem 1rem;
    border: 1px solid #374151;
    border-radius: 8px;
    background: #030712;
  }

  .markdown :global(pre code) {
    display: block;
    padding: 0;
    background: transparent;
    border-radius: 0;
    white-space: pre;
  }
</style>
