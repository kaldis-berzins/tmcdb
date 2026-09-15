import assert from 'node:assert/strict';
import test from 'node:test';
import { modelMessageSchema } from 'ai';
import { Prisma } from '../../../generated/prisma/client';
import { serializeRows } from './sql-serialization';

function toolMessage(rows: unknown[]) {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: 'sql-test',
      toolName: 'runSql',
      output: { type: 'json', value: { ok: true, rowCount: rows.length, rows } }
    }]
  };
}

test('decimal SQL results pass AI SDK validation without losing precision', () => {
  const rows = [{ lindtMentionPct: new Prisma.Decimal('33.333333333333333333') }];

  // Reproduce the rejection from the server log before applying serialization.
  assert.equal(modelMessageSchema.safeParse(toolMessage(rows)).success, false);

  const serialized = serializeRows(rows);
  assert.deepEqual(serialized, [{ lindtMentionPct: '33.333333333333333333' }]);
  assert.equal(modelMessageSchema.safeParse(toolMessage(serialized)).success, true);
});

test('nested SQL values and arrays are serializable without mutating the results', () => {
  const date = new Date('2026-09-15T12:00:00.000Z');
  const rows = [{
    count: 9007199254740993n,
    date,
    values: [new Prisma.Decimal('12.5'), 2n, date, null],
    details: { pct: new Prisma.Decimal('0.125'), label: 'Lindt', active: true, total: 3 }
  }];

  const serialized = serializeRows(rows);
  assert.deepEqual(serialized, [{
    count: '9007199254740993',
    date: date.toISOString(),
    values: ['12.5', '2', date.toISOString(), null],
    details: { pct: '0.125', label: 'Lindt', active: true, total: 3 }
  }]);
  assert.equal(modelMessageSchema.safeParse(toolMessage(serialized)).success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(serialized)), serialized);
  assert.equal(Prisma.Decimal.isDecimal(rows[0]!.details.pct), true);
  assert.equal(rows[0]!.count, 9007199254740993n);
});
