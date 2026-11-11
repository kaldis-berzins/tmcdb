import type { CitationSearchResult } from './types';

export function citationSummary(result: CitationSearchResult): string {
  const state = result.hasMore ? 'Partial search' : 'Search finished';
  const count = result.total ?? result.verifiedSoFar;
  const candidates = result.candidateTotal ?? result.candidatesSoFar;
  return `${state} for ${result.target.title}${result.target.caseNumber ? ` (${result.target.caseNumber})` : ''}: ${count} verified citing decision(s)${result.hasMore ? ' found so far' : ' in the stored collection'}. ${candidates} additional decision(s) mention the docket without establishing the selected document. ${result.hasMore ? 'Use Continue search to retrieve the remaining candidates. ' : ''}${result.coverage.missingTexts} decision(s) lack text; ${result.coverage.unprocessedDecisions} have unprocessed citations. This does not establish coverage of all EUIPO case law.`;
}

export function mergeCitationPages(previous: CitationSearchResult | undefined, next: CitationSearchResult): CitationSearchResult {
  if (!previous || previous.target.key !== next.target.key) return next;
  const decisions = [...new Map([...previous.decisions, ...next.decisions].map((decision) => [decision.id, decision])).values()];
  return { ...next, decisions };
}
