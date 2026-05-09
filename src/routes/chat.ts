import { deepseek } from '@ai-sdk/deepseek';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { Hono } from 'hono';
import { connectScrapling, type MCPClient } from '../lib/mcp.js';
import { SYSTEM_PROMPT } from '../prompts/system.js';
import { findLocalBusinesses } from '../tools/places.js';

export const chatRoute = new Hono();

chatRoute.post('/', async (c) => {
  const { messages } = await c.req.json<{ messages: UIMessage[] }>();

  let scrapling: MCPClient | undefined;

  try {
    scrapling = await connectScrapling();
    const scraplingTools = await scrapling.tools();

    const result = streamText({
      model: deepseek('deepseek-chat'),
      system: SYSTEM_PROMPT,
      messages: convertToModelMessages(messages),
      tools: {
        ...scraplingTools,
        find_local_businesses: findLocalBusinesses,
      },
      stopWhen: stepCountIs(8),
      onFinish: async () => {
        await scrapling?.close();
      },
      onError: async () => {
        await scrapling?.close();
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    await scrapling?.close();
    console.error('chat error', err);
    return c.json({ error: 'agent_failed', detail: String(err) }, 500);
  }
});
