// src/lib/server/sql.ts
import { withReadOnlyTransaction, QueryValidationError } from './read-only';
import { serializeRows } from './sql-serialization';

const FORBIDDEN_SQL = [
  /\bset_config\b/i,
  /\binsert\b/i,
  /\bupdate\b/i,
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\balter\b/i,
  /\btruncate\b/i,
  /\bcreate\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bmerge\b/i,
  /\bcall\b/i,
  /\bcopy\b/i,
  /\bexecute\b/i,
  /\bprepare\b/i,
  /\bdeallocate\b/i,
  /\bvacuum\b/i,
  /\banalyze\b/i,
  /\breindex\b/i,
  /\brefresh\b/i,
  /\bset\b/i,
  /\breset\b/i
];

function stripSqlCommentsAndQuotedContent(sql: string) {
  let sanitized = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === "'" || char === '"') {
      const quote = char;
      sanitized += ' ';
      index += 1;

      while (index < sql.length) {
        const current = sql[index];
        const following = sql[index + 1];

        sanitized += current === '\n' ? '\n' : ' ';

        if (current === quote) {
          if (following === quote) {
            sanitized += ' ';
            index += 2;
            continue;
          }

          index += 1;
          break;
        }

        index += 1;
      }

      continue;
    }

    if (char === '-' && next === '-') {
      sanitized += '  ';
      index += 2;

      while (index < sql.length && sql[index] !== '\n') {
        sanitized += ' ';
        index += 1;
      }

      continue;
    }

    if (char === '/' && next === '*') {
      sanitized += '  ';
      index += 2;

      while (index < sql.length) {
        const current = sql[index];
        const following = sql[index + 1];

        if (current === '*' && following === '/') {
          sanitized += '  ';
          index += 2;
          break;
        }

        sanitized += current === '\n' ? '\n' : ' ';
        index += 1;
      }

      continue;
    }

    if (char === '$') {
      const dollarQuote = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/) ?? sql.slice(index).match(/^\$\$/);

      if (dollarQuote) {
        const delimiter = dollarQuote[0];
        sanitized += ' '.repeat(delimiter.length);
        index += delimiter.length;

        while (index < sql.length) {
          if (sql.startsWith(delimiter, index)) {
            sanitized += ' '.repeat(delimiter.length);
            index += delimiter.length;
            break;
          }

          sanitized += sql[index] === '\n' ? '\n' : ' ';
          index += 1;
        }

        continue;
      }
    }

    sanitized += char;
    index += 1;
  }

  return sanitized;
}

export function validateReadOnlySql(sql: string) {
  const trimmed = sql.trim();

  if (!trimmed) {
    throw new QueryValidationError('SQL query is empty.');
  }

  const sanitizedSql = stripSqlCommentsAndQuotedContent(trimmed);

  // Avoid multiple statements.
  // You can loosen this, but single-statement SQL is much safer.
  if (sanitizedSql.includes(';')) {
    const withoutFinalSemicolon = sanitizedSql.replace(/;\s*$/, '');
    if (withoutFinalSemicolon.includes(';')) {
      throw new QueryValidationError('Only one SQL statement is allowed.');
    }
  }

  const normalized = trimmed.replace(/;\s*$/, '').trim();
  const normalizedSanitized = sanitizedSql.replace(/;\s*$/, '').trim();

  if (!/^(select|with)\b/i.test(normalizedSanitized)) {
    throw new QueryValidationError('Only SELECT or WITH queries are allowed.');
  }

  for (const pattern of FORBIDDEN_SQL) {
    if (pattern.test(normalizedSanitized)) {
      throw new QueryValidationError(`Forbidden SQL keyword detected: ${pattern}`);
    }
  }

  return normalized;
}

export async function runReadOnlySql(sql: string, maxRows = 100) {
  const validatedSql = validateReadOnlySql(sql);
  const limit = Number.isFinite(maxRows) ? Math.min(Math.max(Math.floor(maxRows), 1), 500) : 100;

  // Wrap the user/model query so the outer query enforces the final row limit.
  // This avoids relying entirely on the model to remember LIMIT.
  const wrappedSql = `
    SELECT *
    FROM (
      ${validatedSql}
    ) AS llm_query_result
    LIMIT ${limit + 1}
  `;

  const rows = await withReadOnlyTransaction((tx) => tx.$queryRawUnsafe<unknown[]>(wrappedSql));
  return {
    rows: serializeRows(rows.slice(0, limit)), rowCount: Math.min(rows.length, limit),
    truncated: rows.length > limit,
    completeness: 'unknown' as const,
    limitation: 'This is a SQL result, not a completeness guarantee. The query may contain its own LIMIT.'
  };
}
