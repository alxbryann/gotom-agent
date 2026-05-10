import { Hono } from 'hono';
import { chatRoute } from './routes/chat.js';
import { prospectSimRoute } from './routes/prospect-sim.js';
import { ttsRoute } from './routes/tts.js';

export const app = new Hono();

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
app.route('/api/prospect-sim', prospectSimRoute);
app.route('/api/tts', ttsRoute);

export default app;
