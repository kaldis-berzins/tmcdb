import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

const markdown = new MarkdownIt({
  // Agent responses are untrusted; escape HTML and retain the parser's URL validation.
  html: false,
  breaks: true,
  linkify: true
}).use(taskLists);

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(text: string): string {
  return markdown.render(text);
}
