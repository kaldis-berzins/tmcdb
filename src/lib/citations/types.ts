export type Authority = {
  key: string;
  title: string;
  caseNumber: string | null;
  ecli: string | null;
  date: string | null;
  court: string | null;
  documentType: 'judgment' | 'opinion' | 'order' | null;
  scope: 'document' | 'case';
  identitySource: string;
};
export type CaseResolution = { status: 'resolved' | 'ambiguous' | 'unresolved'; candidates: Authority[]; explanation: string };
export type CitationEvidence = { reference: string; passage: string; offset: number | null; source: 'citation' | 'decision_text'; verification: 'verified' | 'case_only' };
export type CitingDecision = {
  id: string; sourceKey: string; caseNumber: string; date: string | null; institution: string;
  decisionUrl: string | null; badFaithOutcome: string | null;
  verification: 'verified' | 'case_only'; evidence: CitationEvidence[]; evidenceCount: number;
};
export type CitationCoverage = { decisions: number; missingTexts: number; unprocessedDecisions: number; unresolvedReferences: number };
export type CitationSearchResult = {
  ok: true; target: Authority; decisions: CitingDecision[]; hasMore: boolean; nextCursor: string | null;
  total: number | null; candidateTotal: number | null; verifiedSoFar: number; candidatesSoFar: number;
  status: 'complete' | 'partial'; scanned: number; coverage: CitationCoverage; limitations: string[];
};
