import { createMCPClient } from '@ai-sdk/mcp';

export type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * MCPClient compartido entre requests.
 *
 * Antes abríamos un cliente nuevo por cada `POST /api/chat`, lo que se traducía
 * en el log a 1 línea "[chat] Scrapling MCP listo" por mensaje + ~500-1000ms de
 * overhead de handshake + sesiones huérfanas en el server de Scrapling cuando
 * la conversación encadenaba tools.
 *
 * Ahora memoizamos la promesa de conexión. Si la URL cambia (HMR / env reload)
 * o el cliente se cae, llamamos a `getScraplingClient()` para reconectar.
 */
let cached:
  | { url: string; clientPromise: Promise<MCPClient> }
  | undefined;

// Circuit breaker: tras un fallo de conexión, marcamos el endpoint como caído
// durante COOLDOWN_MS para no reintentar (y bloquear ~10s) en cada request.
const COOLDOWN_MS = 60_000;
let downUntil:
  | { url: string; until: number; reason: string }
  | undefined;

async function buildClient(url: string): Promise<MCPClient> {
  return createMCPClient({
    transport: { type: 'http', url },
  });
}

export async function getScraplingClient(): Promise<MCPClient | undefined> {
  const url = process.env.SCRAPLING_MCP_URL?.trim();
  if (!url) return undefined;

  if (downUntil && downUntil.url === url && downUntil.until > Date.now()) {
    return undefined;
  }

  if (!cached || cached.url !== url) {
    if (cached) {
      cached.clientPromise.then((c) => c.close().catch(() => {})).catch(() => {});
    }
    cached = { url, clientPromise: buildClient(url) };
  }

  try {
    return await cached.clientPromise;
  } catch (err) {
    cached = undefined;
    downUntil = {
      url,
      until: Date.now() + COOLDOWN_MS,
      reason: err instanceof Error ? err.message : String(err),
    };
    throw err;
  }
}

export function resetScraplingClient(): void {
  if (cached) {
    cached.clientPromise.then((c) => c.close().catch(() => {})).catch(() => {});
    cached = undefined;
  }
}
