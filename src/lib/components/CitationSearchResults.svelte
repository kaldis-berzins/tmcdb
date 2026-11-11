<script lang="ts">
  import { untrack } from 'svelte';
  import type { CitationSearchResult } from '../citations/types';
  import { citationSummary, mergeCitationPages } from '../citations/presentation';
  let { result }: { result: CitationSearchResult } = $props();
  let shown = $state(untrack(() => result));
  let loading = $state(false);
  let error = $state('');
  $effect(() => { shown = result; });
  function safeUrl(value: string | null) {
    try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
  }
  async function continueSearch() {
    if (!shown.nextCursor || loading) return;
    loading = true;
    error = '';
    try {
      const response = await fetch('/api/citations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: shown.target.key, cursor: shown.nextCursor, pageSize: 25 }) });
      const next = await response.json();
      if (!response.ok || !next.ok) throw new Error(next.error ?? 'Unable to continue the search.');
      shown = mergeCitationPages(shown, next);
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Unable to continue the search.'; }
    finally { loading = false; }
  }
</script>

<section class="citation-results" aria-label="Citation search results">
  <h2>{shown.target.title}</h2>
  <p>{shown.target.caseNumber ?? ''} · {shown.target.ecli ?? ''} {shown.target.date ? `· ${shown.target.date}` : ''}</p>
  {#if safeUrl(shown.target.identitySource)}
    <a href={shown.target.identitySource} target="_blank" rel="noreferrer">Authority identity source</a>
  {:else}
    <p>{shown.target.identitySource}</p>
  {/if}
  <p class="status" role="status">{citationSummary(shown)}</p>
  {#each ['verified', 'case_only'] as verification}
    {@const decisions = shown.decisions.filter((decision) => decision.verification === verification)}
    <h3>{verification === 'verified' ? 'Verified citing decisions' : 'Docket mentions requiring document verification'} ({decisions.length} displayed)</h3>
    {#if decisions.length}
      <div class="table-wrapper">
        <table>
          <thead><tr><th>Decision</th><th>Date / institution</th><th>Evidence</th></tr></thead>
          <tbody>
            {#each decisions as decision (decision.id)}
              <tr>
                <td>
                  {#if safeUrl(decision.decisionUrl)}
                    <a href={decision.decisionUrl ?? ''} target="_blank" rel="noreferrer">{decision.caseNumber}</a>
                  {:else}{decision.caseNumber}{/if}
                  <div class="source-key">Source: <code>{decision.sourceKey}</code></div>
                  {#if decision.badFaithOutcome}<div>{decision.badFaithOutcome}</div>{/if}
                </td>
                <td>{decision.date ?? 'Date unavailable'}<br />{decision.institution}</td>
                <td>
                  {#each decision.evidence as evidence}
                    {@const matchAt = evidence.passage.indexOf(evidence.reference)}
                    <details>
                      <summary>{evidence.reference} · {evidence.verification === 'verified' ? 'verified' : 'document uncertain'}</summary>
                      <p class="passage">{#if matchAt >= 0}{evidence.passage.slice(0, matchAt)}<mark>{evidence.reference}</mark>{evidence.passage.slice(matchAt + evidence.reference.length)}{:else}{evidence.passage}{/if}</p>
                      <small>{evidence.source === 'decision_text' ? 'Decision text' : 'Stored citation passage'}{evidence.offset !== null ? ` · character ${evidence.offset}` : ''}</small>
                    </details>
                  {/each}
                  {#if decision.evidenceCount > decision.evidence.length}<small>{decision.evidenceCount} passages found; first {decision.evidence.length} shown.</small>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}<p>No {verification === 'verified' ? 'verified citing decisions' : 'uncertain docket mentions'} in the pages retrieved.</p>{/if}
  {/each}
  {#if shown.hasMore}<button type="button" disabled={loading} onclick={continueSearch}>{loading ? 'Searching…' : 'Continue search'}</button>{/if}
  {#if error}<p role="alert">{error} Previously retrieved results remain available.</p>{/if}
  <details><summary>Coverage and search limitations</summary>
    <p>{shown.coverage.decisions} stored decisions; {shown.coverage.unresolvedReferences} citation rows have unresolved targets.</p>
    <ul>{#each shown.limitations as limitation}<li>{limitation}</li>{/each}</ul>
  </details>
</section>

<style>
  h2 { font-size: 1.1rem; }
  h3 { font-size: 1rem; margin-top: 1.5rem; }
  .citation-results { border: 1px solid #4b5563; padding: 1rem; border-radius: 0.6rem; }
  .status { background: #1e293b; padding: 0.75rem; border-radius: 0.4rem; }
  .table-wrapper { overflow: auto; max-height: 36rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; vertical-align: top; padding: 0.65rem; border: 1px solid #374151; }
  th { background: #374151; }
  td:last-child { min-width: 15rem; }
  a { color: #a5b4fc; }
  .source-key { font-size: 0.8rem; overflow-wrap: anywhere; margin-top: 0.5rem; }
  .passage { white-space: pre-wrap; overflow-wrap: anywhere; }
  mark { background: #fde68a; color: #111827; }
  details { margin: 0.6rem 0; }
  summary { cursor: pointer; }
  button { background: #4f46e5; color: white; padding: 0.6rem 1rem; border: 0; border-radius: 0.4rem; cursor: pointer; margin: 1rem 0; }
  button:disabled { opacity: 0.5; }
</style>
