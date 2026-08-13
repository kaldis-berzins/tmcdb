// src/lib/server/sql.ts
import { prisma } from '../../../lib/prisma';

const FORBIDDEN_SQL = [
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

export function validateReadOnlySql(sql: string) {
  const trimmed = sql.trim();

  if (!trimmed) {
    throw new Error('SQL query is empty.');
  }

  // Avoid multiple statements.
  // You can loosen this, but single-statement SQL is much safer.
  if (trimmed.includes(';')) {
    const withoutFinalSemicolon = trimmed.replace(/;\s*$/, '');
    if (withoutFinalSemicolon.includes(';')) {
      throw new Error('Only one SQL statement is allowed.');
    }
  }

  const normalized = trimmed.replace(/;\s*$/, '').trim();

  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error('Only SELECT or WITH queries are allowed.');
  }

  for (const pattern of FORBIDDEN_SQL) {
    if (pattern.test(normalized)) {
      throw new Error(`Forbidden SQL keyword detected: ${pattern}`);
    }
  }

  return normalized;
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}

function serializeRows(rows: unknown[]) {
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;

    return Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, value]) => [
        key,
        serializeValue(value)
      ])
    );
  });
}

export async function runReadOnlySql(sql: string, maxRows = 100) {
  const validatedSql = validateReadOnlySql(sql);

  // Wrap the user/model query so the outer query enforces the final row limit.
  // This avoids relying entirely on the model to remember LIMIT.
  const wrappedSql = `
    SELECT *
    FROM (
      ${validatedSql}
    ) AS llm_query_result
    LIMIT ${Math.min(Math.max(maxRows, 1), 500)}
  `;

  const rows = await prisma.$transaction(async (tx) => {
    // Prevent long-running queries.
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);

    // Make the transaction read-only at the database level.
    await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);

    return tx.$queryRawUnsafe<unknown[]>(wrappedSql);
  });

  return serializeRows(rows);
}