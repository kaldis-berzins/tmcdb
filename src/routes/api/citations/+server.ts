import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { findCitingDecisions } from '../../../lib/server/citation-search';
import { classifyQueryError } from '../../../lib/server/read-only';
const inputSchema = z.object({ key: z.string().max(200), cursor: z.string().min(1).max(2000), pageSize: z.number().int().min(1).max(100).default(25) });
export async function POST({ request }) {
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return json({ ok: false, error: 'A valid search continuation is required.' }, { status: 400 });
  try { return json(await findCitingDecisions(input.data.key, { cursor: input.data.cursor, pageSize: input.data.pageSize })); }
  catch (error) { return json(classifyQueryError(error), { status: 400 }); }
}
