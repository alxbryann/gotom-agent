import { Hono } from 'hono';
import { z } from 'zod';
import { synthesizeSpeech } from '../lib/elevenlabs.js';

const bodySchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1).optional(),
  modelId: z.string().min(1).optional(),
});

export const ttsRoute = new Hono();

ttsRoute.post('/', async (c) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'missing_elevenlabs_key', detail: 'Set ELEVENLABS_API_KEY' }, 503);
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const json = await c.req.json();
    parsed = bodySchema.parse(json);
  } catch (e) {
    return c.json({ error: 'invalid_body', detail: String(e) }, 400);
  }

  try {
    const upstream = await synthesizeSpeech(apiKey, {
      text: parsed.text,
      voiceId: parsed.voiceId,
      modelId: parsed.modelId,
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    c.header('Content-Type', 'audio/mpeg');
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(buf, 200);
  } catch (err) {
    console.error('tts error', err);
    return c.json({ error: 'tts_failed', detail: String(err) }, 502);
  }
});
