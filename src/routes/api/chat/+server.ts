import { createChatResponse } from '../../../lib/server/chat';

export async function POST({ request }) {
  return createChatResponse(request);
}
