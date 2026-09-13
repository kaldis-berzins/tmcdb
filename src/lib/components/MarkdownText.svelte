<script lang="ts">
  let { text } = $props<{ text: string }>();

  const codeFencePattern = /^```([\w-]+)?\s*$/;
  const unorderedListPattern = /^\s*[-*+]\s+(.*)$/;
  const orderedListPattern = /^\s*\d+\.\s+(.*)$/;
  const headingPattern = /^(#{1,6})\s+(.*)$/;
  const blockquotePattern = /^>\s?(.*)$/;
  const inlineCodePattern = /`([^`]+)`/g;
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
  const strongPattern = /\*\*([^*]+)\*\*/g;
  const emphasisPattern = /(^|[\s(>])\*([^*]+)\*(?=[\s).,!?:;]|$)/g;

  function escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function escapeAttribute(value: string): string {
    return escapeHtml(value);
  }

  function renderInline(value: string): string {
    const codeSegments: string[] = [];
    let html = escapeHtml(value);

    html = html.replace(inlineCodePattern, (_, code: string) => {
      const placeholder = `__CODE_${codeSegments.length}__`;
      codeSegments.push(`<code>${escapeHtml(code)}</code>`);
      return placeholder;
    });

    html = html.replace(linkPattern, (_, label: string, href: string) => {
      return `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${label}</a>`;
    });

    html = html.replace(strongPattern, '<strong>$1</strong>');
    html = html.replace(emphasisPattern, '$1<em>$2</em>');
    html = html.replaceAll('\n', '<br />');

    for (const [index, code] of codeSegments.entries()) {
      html = html.replace(`__CODE_${index}__`, code);
    }

    return html;
  }

  function renderMarkdown(value: string): string {
    const lines = value.replaceAll('\r\n', '\n').split('\n');
    const blocks: string[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index] ?? '';

      if (!line.trim()) {
        index += 1;
        continue;
      }

      const codeFenceMatch = line.match(codeFencePattern);
      if (codeFenceMatch) {
        const language = codeFenceMatch[1]?.trim();
        const codeLines: string[] = [];
        index += 1;

        while (index < lines.length && !(lines[index] ?? '').match(codeFencePattern)) {
          codeLines.push(lines[index] ?? '');
          index += 1;
        }

        if (index < lines.length) {
          index += 1;
        }

        const languageClass = language ? ` class="language-${escapeAttribute(language)}"` : '';
        blocks.push(
          `<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`
        );
        continue;
      }

      const headingMatch = line.match(headingPattern);
      if (headingMatch) {
        const hashes = headingMatch[1] ?? '#';
        const headingText = headingMatch[2] ?? '';
        const level = hashes.length;
        blocks.push(`<h${level}>${renderInline(headingText)}</h${level}>`);
        index += 1;
        continue;
      }

      if (line.match(unorderedListPattern)) {
        const items: string[] = [];

        while (index < lines.length) {
          const itemMatch = (lines[index] ?? '').match(unorderedListPattern);
          if (!itemMatch) break;
          items.push(`<li>${renderInline(itemMatch[1] ?? '')}</li>`);
          index += 1;
        }

        blocks.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (line.match(orderedListPattern)) {
        const items: string[] = [];

        while (index < lines.length) {
          const itemMatch = (lines[index] ?? '').match(orderedListPattern);
          if (!itemMatch) break;
          items.push(`<li>${renderInline(itemMatch[1] ?? '')}</li>`);
          index += 1;
        }

        blocks.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      if (line.match(blockquotePattern)) {
        const quoteLines: string[] = [];

        while (index < lines.length) {
          const quoteMatch = (lines[index] ?? '').match(blockquotePattern);
          if (!quoteMatch) break;
          quoteLines.push(quoteMatch[1] ?? '');
          index += 1;
        }

        blocks.push(`<blockquote>${renderInline(quoteLines.join('\n'))}</blockquote>`);
        continue;
      }

      const paragraphLines: string[] = [];

      while (index < lines.length) {
        const currentLine = lines[index] ?? '';
        if (!currentLine.trim()) break;
        if (currentLine.match(codeFencePattern)) break;
        if (currentLine.match(headingPattern)) break;
        if (currentLine.match(unorderedListPattern)) break;
        if (currentLine.match(orderedListPattern)) break;
        if (currentLine.match(blockquotePattern)) break;

        paragraphLines.push(currentLine);
        index += 1;
      }

      blocks.push(`<p>${renderInline(paragraphLines.join('\n'))}</p>`);
    }

    return blocks.join('');
  }
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
  .markdown :global(pre) {
    margin: 0 0 0.9rem;
  }

  .markdown :global(p:last-child),
  .markdown :global(ul:last-child),
  .markdown :global(ol:last-child),
  .markdown :global(blockquote:last-child),
  .markdown :global(pre:last-child) {
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
