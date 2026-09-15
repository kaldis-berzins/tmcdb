import { Prisma } from '../../../generated/prisma/client';

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint' || Prisma.Decimal.isDecimal(value)) {
    // Preserve precision while producing values accepted by the AI SDK's JSON schema.
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)])
    );
  }

  return value;
}

export function serializeRows(rows: unknown[]) {
  return rows.map(serializeValue);
}
