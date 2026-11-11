import { prisma } from '../../../lib/prisma';
import type { Prisma } from '../../../generated/prisma/client';

function budget(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
export const statementTimeoutMs = budget('SQL_STATEMENT_TIMEOUT_MS', 10_000);
export const transactionTimeoutMs = Math.max(budget('SQL_TRANSACTION_TIMEOUT_MS', 15_000), statementTimeoutMs + 5_000);

export function withReadOnlyTransaction<T>(query: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${statementTimeoutMs}ms'`);
    return query(tx);
  }, { timeout: transactionTimeoutMs });
}

export class QueryValidationError extends Error {}
export type QueryFailure = { ok: false; kind: 'validation' | 'timeout' | 'connection' | 'invalid_sql' | 'execution'; error: string; retryable: boolean };
export function classifyQueryError(error: unknown): QueryFailure {
  if (error instanceof QueryValidationError) return { ok: false, kind: 'validation', error: error.message, retryable: false };
  const details = error instanceof Error ? `${error.message} ${JSON.stringify((error as { code?: string; meta?: unknown }).meta ?? {})} ${(error as { code?: string }).code ?? ''}` : String(error);
  if (/57014|P2028|statement timeout|transaction.*(?:expired|timed out)|timeout/i.test(details)) {
    return { ok: false, kind: 'timeout', error: 'The query exceeded its time budget. The search is incomplete; this is not an empty result.', retryable: true };
  }
  if (/P100[012]|P1017|P2024|ECONN|ENOTFOUND|EPERM|connection.*(?:closed|refused|terminated)/i.test(details)) {
    return { ok: false, kind: 'connection', error: 'The database connection failed. The search did not complete.', retryable: true };
  }
  const kind = /42\w{3}|syntax error|does not exist|ambiguous column/i.test(details) ? 'invalid_sql' : 'execution';
  return { ok: false, kind, error: kind === 'invalid_sql' ? details.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database]').slice(0, 600) : 'The database query failed. The search did not complete.', retryable: kind === 'invalid_sql' };
}
