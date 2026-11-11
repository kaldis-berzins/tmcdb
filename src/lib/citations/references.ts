/** Pure reference parsing shared by ingestion and retrieval. Offsets refer to original text. */
export type CitationCandidate = {
  rawReference: string;
  normalizedReference: string;
  snippet: string;
  offset: number;
  date: string | null;
  documentType: 'judgment' | 'opinion' | 'order' | null;
  ecli: string | null;
};

const space = '[\\s\\u00ad]*';
const court = `[CTF]${space}[-\\u2010-\\u2015\\u2212]?${space}\\d{1,7}${space}/${space}\\d{2,4}(?:[\\s\\u00ad]+(?:PPU|P|RENV|RX|R)(?:[\\s\\u00ad]*\\(R\\)|-II)?)?`;
const board = `R${space}\\d{1,7}${space}/${space}\\d{2,4}${space}[-\\u2010-\\u2015\\u2212]${space}\\d+`;
const ecli = `(?:ECLI${space}:${space})?EU${space}:${space}[CTF]${space}:${space}\\d{4}${space}:${space}\\d+`;
const referencePattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${ecli}|${court}|${board})(?![\\p{L}\\p{N}_/])`, 'giu');

export function normalizeCaseReference(value: string): string {
  let normalized = value.toUpperCase().replace(/\u00ad/g, '')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim()
    .replace(/^(?:JOINED\s+CASES?|CASES?)\s+/, '')
    .replace(/[\],.;:]+$/g, '').replace(/\s+(?:AND|ET|Y)$/, '')
    .replace(/\s*([/:-])\s*/g, '$1');
  if (/^(?:ECLI:)?EU:[CTF]:\d{4}:\d+$/.test(normalized)) return normalized.replace(/^ECLI:/, '');
  normalized = normalized.replace(/^([CTF])\s*-?\s*(\d)/, '$1-$2')
    .replace(/^R\s*(\d)/, 'R $1').replace(/^([CTF]-|R )0+(?=\d)/, '$1');
  if (/^[CTF]-/.test(normalized)) normalized = normalized.replace(/\/(?:19|20)(\d{2})(?=\s|$)/, '/$1');
  return normalized;
}

export function isCompleteReference(value: string): boolean {
  const matches = [...value.matchAll(referencePattern)];
  return matches.length === 1 && matches[0]![0].length === value.length;
}

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function precedingDate(prefix: string): string | null {
  const pattern = /\b(?:(\d{1,2})[/.](\d{1,2})[/.](\d{4})|(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4}))\b/gi;
  const dates = [...prefix.matchAll(pattern)];
  const last = dates.at(-1);
  if (!last) return null;
  const day = Number(last[1] ?? last[4]);
  const month = last[2] ? Number(last[2]) : months.indexOf(last[5]!.toLowerCase()) + 1;
  const year = Number(last[3] ?? last[6]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

export function extractCandidates(text: string): CitationCandidate[] {
  const matches = [...text.matchAll(referencePattern)];
  return matches.map((match, index) => {
    const offset = match.index;
    // A date after this reference may belong to the next authority. Only associate
    // dates preceding it, without crossing a different reference or sentence.
    let prefix = text.slice(Math.max(matches[index - 1] ? matches[index - 1]!.index + matches[index - 1]![0].length : 0, offset - 200), offset);
    prefix = prefix.split(/\n\s*\n|[!?;]|\.(?:\s|$)/).at(-1) ?? '';
    const kind = [...prefix.matchAll(/\b(judgment|opinion|order)\b/gi)].at(-1)?.[1]?.toLowerCase();
    const following = matches[index + 1];
    const normalized = normalizeCaseReference(match[0]);
    const adjacentEcli = following && normalizeCaseReference(following[0]).startsWith('EU:') && following.index - offset < 250 && !text.slice(offset + match[0].length, following.index).includes(';') ? normalizeCaseReference(following[0]) : null;
    return {
      ecli: normalized.startsWith('EU:') ? normalized : adjacentEcli,
      rawReference: match[0], normalizedReference: normalizeCaseReference(match[0]), offset,
      snippet: text.slice(Math.max(0, offset - 220), Math.min(text.length, offset + match[0].length + 320)).trim(),
      date: precedingDate(prefix), documentType: (kind as CitationCandidate['documentType']) ?? null
    };
  });
}

/** A PostgreSQL candidate filter only; every result must pass the shared parser. */
export function referencePrefilter(reference: string): string {
  const normalized = normalizeCaseReference(reference);
  const gap = '[[:space:]\u00ad]*';
  const courtMatch = /^([CTF])-(\d+)\/(\d{2,4})/.exec(normalized);
  const boardMatch = /^R (\d+)\/(\d{2,4})-(\d+)$/.exec(normalized);
  let body: string;
  if (courtMatch) {
    const [, prefix, number, year] = courtMatch;
    body = `${prefix}${gap}[-\u2010-\u2015\u2212]?${gap}0*${number}${gap}/${gap}${year!.length === 2 ? '(19|20)?' : ''}${year}`;
  } else if (boardMatch) {
    body = `R${gap}0*${boardMatch[1]}${gap}/${gap}${boardMatch[2]}${gap}[-\u2010-\u2015\u2212]${gap}${boardMatch[3]}`;
  } else if (/^EU:[CTF]:\d{4}:\d+$/.test(normalized)) {
    body = normalized.split(':').join(`${gap}:${gap}`);
  } else {
    throw new Error('A complete case reference or ECLI is required.');
  }
  return `(^|[^[:alnum:]_])${body}($|[^[:alnum:]_/])`;
}
