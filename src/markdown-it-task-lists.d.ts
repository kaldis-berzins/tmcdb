declare module 'markdown-it-task-lists' {
  import type { MarkdownIt } from 'markdown-it';

  export default function taskLists(markdown: MarkdownIt): void;
}
