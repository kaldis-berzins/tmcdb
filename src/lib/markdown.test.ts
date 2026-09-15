import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from './markdown';

test('renders tables, nested lists, task lists, and strikethrough in agent responses', () => {
  const html = renderMarkdown([
    '| Decision | Result |',
    '| --- | ---: |',
    '| **Example** | ~~Pending~~ Granted |',
    '',
    '3. Review decisions',
    '   - Read **key _findings_**',
    '   - [x] Check citations',
    '   - [ ] Draft summary'
  ].join('\n'));

  assert.match(html, /<table>/);
  assert.match(html, /<th style="text-align:right">Result<\/th>/);
  assert.match(html, /<s>Pending<\/s>/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<li>Review decisions\n<ul/);
  assert.match(html, /<strong>key <em>findings<\/em><\/strong>/);
  assert.match(html, /<input[^>]*checked=""[^>]*disabled=""[^>]*type="checkbox">/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2);
});

test('preserves code literally without double escaping or interpreting markdown', () => {
  const html = renderMarkdown('`a < b && **literal**`\n\n~~~~sql\nSELECT \'<tag>\', \'&\';\n```\n~~~~');

  assert.match(html, /<code>a &lt; b &amp;&amp; \*\*literal\*\*<\/code>/);
  assert.match(html, /<pre><code class="language-sql">SELECT '&lt;tag&gt;', '&amp;';\n```\n<\/code><\/pre>/);
  assert.doesNotMatch(html, /&amp;lt;|<strong>/);
});

test('handles reference links, parentheses in URLs, autolinks, and escaped query strings', () => {
  const html = renderMarkdown([
    '[**Decision**][source]',
    '',
    '[source]: https://example.com/case_(1)?a=1&b=2',
    '',
    'https://example.com/other'
  ].join('\n'));

  assert.match(html, /href="https:\/\/example.com\/case_\(1\)\?a=1&amp;b=2"/);
  assert.match(html, /<strong>Decision<\/strong><\/a>/);
  assert.match(html, /href="https:\/\/example.com\/other"/);
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length, 2);
});

test('escapes raw HTML including HTML inside task lists', () => {
  const html = renderMarkdown([
    '<script>alert(1)</script>',
    '',
    '<img src=x onerror="alert(1)">',
    '',
    '- [x] <svg onload="alert(1)">'
  ].join('\n'));

  assert.doesNotMatch(html, /<(?:script|img|svg)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
});

test('rejects unsafe link and image URLs, including entity obfuscation', () => {
  for (const url of [
    'javascript:alert%281%29',
    'jav&#x61;script:alert%281%29',
    'vbscript:evil',
    'file:///etc/passwd',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4='
  ]) {
    const html = renderMarkdown(`[click](${url})\n\n![image](${url})`);
    assert.doesNotMatch(html, /<(?:a|img)\b/, url);
  }
});

test('renders partial streaming responses and completes an open code fence', () => {
  const text = '## Results\n\n**Summary**\n\n```sql\nSELECT \'<script>\';\n```';
  for (let length = 0; length <= text.length; length += 1) {
    assert.doesNotThrow(() => renderMarkdown(text.slice(0, length)));
  }

  assert.equal(renderMarkdown(''), '');
  assert.match(renderMarkdown('first\nsecond'), /first<br>\nsecond/);
  assert.match(renderMarkdown('```sql\nSELECT 1'), /<pre><code class="language-sql">SELECT 1<\/code><\/pre>/);
});
