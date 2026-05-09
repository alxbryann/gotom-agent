import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { chatRoute } from './routes/chat.js';
import { ttsRoute } from './routes/tts.js';

const app = new Hono();

app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'gotom-agent',
    scrapling: process.env.SCRAPLING_MCP_URL,
  }),
);

app.route('/api/chat', chatRoute);
app.route('/api/tts', ttsRoute);

const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, port });
console.log(`gotom-agent listening on http://localhost:${port}`);
