import { deepseek } from '@ai-sdk/deepseek';
import { convertToModelMessages, streamText, type UIMessage } from 'ai';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ProspectSimulationContext } from '../prompts/prospect-sim.js';
import { buildProspectSimulationSystem } from '../prompts/prospect-sim.js';

export const prospectSimRoute = new Hono();

const cardSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  body: z.string(),
  category: z.string().optional(),
});

const simulationContextSchema = z.object({
  sessionId: z.string().optional(),
  clientSnapshot: z.record(z.unknown()),
  cards: z.array(cardSchema),
  pitchCardIds: z.array(z.string()).optional(),
  pitchMarkdown: z.string().min(1),
  pitchStructured: z.record(z.unknown()).optional(),
});

const bodySchema = z.object({
  messages: z.array(z.unknown()),
  simulationContext: simulationContextSchema,
});

prospectSimRoute.post('/', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);

  if (!parsed.success) {
    return c.json({ error: 'invalid_body', detail: parsed.error.flatten() }, 400);
  }

  if (!process.env.DEEPSEEK_API_KEY?.trim()) {
    return c.json({ error: 'missing_deepseek_key', detail: 'Set DEEPSEEK_API_KEY' }, 503);
  }

  const { messages, simulationContext } = parsed.data;
  const ctx = simulationContext as ProspectSimulationContext;

  try {
    const system = buildProspectSimulationSystem(ctx);

    const result = streamText({
      model: deepseek('deepseek-chat'),
      system,
      messages: convertToModelMessages(messages as UIMessage[]),
      onError: ({ error }) => {
        console.error('[prospect-sim] streamText error:', error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error('[prospect-sim] error', err);
    return c.json({ error: 'prospect_sim_failed', detail: String(err) }, 500);
  }
});
