import type { Tool } from 'ai';

type McpContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType?: string }
  | Record<string, unknown>;

type McpCallToolResult = {
  content?: McpContentPart[];
  structuredContent?: unknown;
  isError?: boolean;
};

/**
 * Tope duro por llamada a una tool del MCP. Si Scrapling se cuelga (sitios
 * Cloudflare-protected, JS lento), evita que un solo `stealthy_fetch` mantenga
 * la conversación bloqueada minutos. El modelo recibirá un error textual y
 * podrá decidir cambiar de estrategia o avisar al usuario.
 *
 * Damos hasta 5 minutos para tolerar `stealthy_fetch` con `solve_cloudflare`
 * u operaciones muy lentas; el serverless debe tener `maxDuration` acorde.
 */
const TOOL_TIMEOUT_MS = 300_000;

function timeoutMcpResult(toolName: string, ms: number): McpCallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `Tool ${toolName} timeout tras ${Math.round(ms / 1000)}s. Probablemente el sitio está bloqueando o cargando muy lento. Intenta otra URL o avisa al usuario.`,
      },
    ],
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  toolName: string,
): Promise<T | McpCallToolResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<McpCallToolResult>((resolve) => {
    timer = setTimeout(() => resolve(timeoutMcpResult(toolName, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T | McpCallToolResult>;
}

/**
 * Workaround para `@ai-sdk/mcp@1.0.41`:
 *
 * El paquete adjunta `tool.toModelOutput = mcpToModelOutput` con la firma
 * `({ output }) => ...`, pero `ai` lo invoca como `tool.toModelOutput(output)`,
 * así que `output` queda undefined y revienta con:
 *   "TypeError: Cannot use 'in' operator to search for 'content' in undefined"
 * justo después de que la tool del MCP devolvió un resultado válido.
 *
 * Aquí sustituimos `toModelOutput` por una versión con la firma correcta que
 * convierte el `CallToolResult` de MCP en lo que el AI SDK espera.
 */
export function patchMcpToolOutput<T extends Tool>(
  toolName: string,
  rawTool: T,
): T {
  const originalExecute = (rawTool as { execute?: Function }).execute;

  const wrappedExecute = originalExecute
    ? async (args: unknown, opts: unknown) => {
        const start = Date.now();
        try {
          const raced = await withTimeout(
            originalExecute(args, opts) as Promise<unknown>,
            TOOL_TIMEOUT_MS,
            toolName,
          );
          const ms = Date.now() - start;
          const result = raced as McpCallToolResult;
          const status = result?.isError ? 'ERROR' : 'ok';
          console.log(`[tool] ${toolName} ${status} ${ms}ms`);
          return result;
        } catch (err) {
          const ms = Date.now() - start;
          console.log(`[tool] ${toolName} THROW ${ms}ms ${String(err)}`);
          throw err;
        }
      }
    : undefined;

  const patched = {
    ...rawTool,
    ...(wrappedExecute ? { execute: wrappedExecute } : {}),
    toModelOutput: (output: unknown) => {
      if (output == null || typeof output !== 'object') {
        return { type: 'json' as const, value: (output ?? null) as never };
      }

      const result = output as McpCallToolResult;

      if (Array.isArray(result.content)) {
        const value = result.content.map((part) => {
          const p = part as Record<string, unknown>;
          if (p.type === 'text' && typeof p.text === 'string') {
            return { type: 'text' as const, text: p.text as string };
          }
          if (
            p.type === 'image' &&
            typeof p.data === 'string' &&
            typeof p.mimeType === 'string'
          ) {
            return {
              type: 'image-data' as const,
              data: p.data as string,
              mediaType: p.mimeType as string,
            };
          }
          return { type: 'text' as const, text: JSON.stringify(p) };
        });
        return { type: 'content' as const, value };
      }

      return { type: 'json' as const, value: result as never };
    },
  };

  return patched as T;
}

export function patchMcpTools<R extends Record<string, unknown>>(tools: R): R {
  const out: Record<string, unknown> = {};
  for (const [name, tool] of Object.entries(tools)) {
    out[name] = patchMcpToolOutput(name, tool as Tool);
  }
  return out as R;
}
