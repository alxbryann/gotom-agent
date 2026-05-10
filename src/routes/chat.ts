import { deepseek } from '@ai-sdk/deepseek';
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';
import { Hono } from 'hono';
import { getScraplingClient, resetScraplingClient } from '../lib/mcp.js';
import { SYSTEM_PROMPT } from '../prompts/system.js';
import { findLocalBusinessesOsm } from '../tools/osm.js';
import { findBusinessPartner } from '../tools/partner.js';
import { profileProspects } from '../tools/profile-prospects.js';
import { exportToCsv } from '../tools/export-csv.js';
import { patchMcpTools } from '../tools/mcp-fix.js';
import { SCRAPLING_TOOL_SCHEMAS } from '../tools/scrapling-schemas.js';

export const chatRoute = new Hono();

let toolsCache:
  | { tools: Record<string, unknown>; loadedAt: number }
  | undefined;

async function getScraplingTools(): Promise<Record<string, unknown>> {
  const client = await getScraplingClient();
  if (!client) return {};

  // Cache per-process. Las definiciones del MCP no cambian entre requests,
  // así que evitamos volver a llamar `tools/list` en cada chat.
  if (!toolsCache) {
    // IMPORTANTE: pasamos schemas zod explícitos. Si dejamos
    // 'automatic', @ai-sdk/mcp@1.0.41 falla al validar inputs cuyo JSON
    // Schema usa $defs/$ref (todas las tools de Scrapling lo hacen) con:
    //   "Cannot read properties of undefined (reading 'validate')"
    const raw = (await client.tools({
      schemas: SCRAPLING_TOOL_SCHEMAS,
    })) as Record<string, unknown>;
    toolsCache = {
      tools: patchMcpTools(raw),
      loadedAt: Date.now(),
    };
    console.log(
      '[chat] Scrapling MCP listo. tools:',
      Object.keys(toolsCache.tools).join(', '),
    );
  }
  return toolsCache.tools;
}

chatRoute.post('/', async (c) => {
  const { messages } = await c.req.json<{ messages: UIMessage[] }>();

  let scraplingTools: Record<string, unknown> = {};
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Scrapling MCP timeout')), 300_000),
    );
    scraplingTools = await Promise.race([getScraplingTools(), timeout]);
  } catch (err) {
    console.warn('[chat] Scrapling MCP omitido (no conecta):', err);
    resetScraplingClient();
    toolsCache = undefined;
  }

  try {
    const result = streamText({
      model: deepseek('deepseek-chat'),
      system: SYSTEM_PROMPT,
      messages: convertToModelMessages(messages),
      tools: {
        ...scraplingTools,
        find_local_businesses_osm: findLocalBusinessesOsm,
        find_business_partner: findBusinessPartner,
        profile_prospects: profileProspects,
        export_to_csv: exportToCsv,
      },
      // Acotamos el razonamiento autónomo. El pipeline determinista por zona
      // ya consume 2 pasos (find_business_partner + profile_prospects), más
      // export_to_csv si lo piden. Subimos a 10 para tolerar 2 zonas seguidas
      // o algún reintento puntual sin cortar al modelo en mitad del flujo.
      stopWhen: stepCountIs(10),
      onError: ({ error }) => {
        console.error('[chat] streamText error:', error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error('chat error', err);
    return c.json({ error: 'agent_failed', detail: String(err) }, 500);
  }
});
