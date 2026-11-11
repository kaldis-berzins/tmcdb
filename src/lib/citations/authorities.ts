import { extractCandidates, normalizeCaseReference } from './references';
import type { Authority, CaseResolution } from './types';

type AuthorityAlias = Authority & { aliases: string[] };
function judgment(caseNumber: string, title: string, date: string, ecli: string, celex: string, aliases: string[]): AuthorityAlias {
  return { key: `ecli:${ecli}`, title, caseNumber, date, ecli, court: caseNumber.startsWith('T') ? 'GC' : 'ECJ', documentType: 'judgment', scope: 'document', identitySource: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celex}`, aliases };
}
/** Reviewed seed aliases. Add entries only with an identity source; unknown identifiers still work. */
export const AUTHORITIES: AuthorityAlias[] = [
  judgment('C-425/16', 'Raimund v Aigner', '2017-10-19', 'EU:C:2017:776', '62016CJ0425', ['raimund', 'raimund v aigner', 'aigner']),
  judgment('T-56/15', 'Raimund Schmitt / Brauwelt', '2016-10-18', 'EU:T:2016:618', '62015TJ0056', ['raimund', 'raimund schmitt', 'brauwelt']),
  judgment('C-17/24', 'CeramTec v Coorstek Bioceramics', '2025-06-19', 'EU:C:2025:455', '62024CJ0017', ['ceramtec', 'coorstek bioceramics']),
  judgment('C-104/18 P', 'Koton v EUIPO', '2019-09-12', 'EU:C:2019:724', '62018CJ0104', ['koton']),
  judgment('C-529/07', 'Chocoladefabriken Lindt & Sprüngli v Hauswirth', '2009-06-11', 'EU:C:2009:361', '62007CJ0529', ['lindt', 'lindt goldhase', 'hauswirth'])
];
const nameKey = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function publicAuthority({ aliases: _aliases, ...authority }: AuthorityAlias): Authority { return authority; }

export function resolveCase(query: string): CaseResolution {
  const references = [...new Set(extractCandidates(query).map((c) => c.normalizedReference))];
  let candidates: Authority[];
  if (references.length) {
    candidates = references.flatMap((reference) => {
      const known = AUTHORITIES.filter((a) => a.caseNumber === reference || a.ecli === reference);
      if (known.length) return known.map(publicAuthority);
      const isEcli = reference.startsWith('EU:');
      return [{ key: `${isEcli ? 'ecli' : 'case'}:${reference}`, title: reference, caseNumber: isEcli ? null : reference, ecli: isEcli ? reference : null, date: null, court: null, documentType: null, scope: isEcli ? 'document' as const : 'case' as const, identitySource: 'Explicit identifier supplied for this search; no verified title is available.' }];
    });
  } else {
    const name = nameKey(query);
    // Prefer a full specific alias (e.g. Raimund Schmitt) over the shorter ambiguous name.
    const matches = AUTHORITIES.map((authority) => ({ authority, score: Math.max(0, ...authority.aliases.filter((alias) => ` ${name} `.includes(` ${nameKey(alias)} `)).map((alias) => nameKey(alias).length)) }));
    const best = Math.max(0, ...matches.map((m) => m.score));
    candidates = matches.filter((m) => best > 0 && m.score === best).map((m) => publicAuthority(m.authority));
  }
  candidates = [...new Map(candidates.map((c) => [c.key, c])).values()];
  const status = candidates.length === 1 ? 'resolved' : candidates.length ? 'ambiguous' : 'unresolved';
  return { status, candidates, explanation: status === 'ambiguous' ? 'Choose the intended authority before searching. These are different authorities.' : status === 'unresolved' ? 'No verified alias is configured. Supply a complete case number or ECLI; a name substring is not an established identity.' : candidates[0]!.scope === 'case' ? 'Searching this docket; individual documents within it are not distinguished.' : 'Use this authority unchanged for the citation search.' };
}

export function authorityFromKey(key: string): Authority {
  const known = AUTHORITIES.find((a) => a.key === key);
  if (known) return publicAuthority(known);
  const separator = key.indexOf(':');
  const reference = key.slice(separator + 1);
  const result = resolveCase(reference);
  const candidate = result.candidates.find((a) => a.key === key);
  if (!candidate || normalizeCaseReference(reference) !== reference) throw new Error('Resolve the authority before searching.');
  return candidate;
}
