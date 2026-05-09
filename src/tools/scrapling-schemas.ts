import { z } from 'zod';

/**
 * Esquemas zod simplificados para las tools del MCP de Scrapling.
 *
 * Por qué viven aquí: el JSON Schema que devuelve Scrapling usa `$defs`/`$ref`
 * (p.ej. `SetCookieParam`) que la conversión automática a validador interno de
 * `@ai-sdk/mcp@1.0.41` no resuelve, y al validar los args del LLM revienta con:
 *   "Cannot read properties of undefined (reading 'validate')"
 * Pasando estos schemas a `client.tools({ schemas })` sustituimos al validador
 * automático y eliminamos la falla. Mantenemos solo los campos que el modelo
 * de verdad necesita; los exóticos (cookies, proxy_auth, additional_args, etc.)
 * los omitimos a propósito para no inducir alucinaciones de parámetros.
 */

const extractionType = z
  .enum(['markdown', 'text', 'html'])
  .default('markdown')
  .describe('Formato del contenido devuelto.');

const followRedirects = z
  .union([
    z.boolean(),
    z.enum(['safe', 'all', 'obeycode', 'firstonly']),
  ])
  .default('safe')
  .describe('Política de redirecciones HTTP.');

const commonHttpParams = {
  extraction_type: extractionType.optional(),
  css_selector: z.string().nullable().optional(),
  main_content_only: z.boolean().default(true).optional(),
  timeout: z.number().int().positive().default(30).optional(),
  follow_redirects: followRedirects.optional(),
  retries: z.number().int().min(0).max(5).default(2).optional(),
  stealthy_headers: z.boolean().default(true).optional(),
} as const;

const commonBrowserParams = {
  extraction_type: extractionType.optional(),
  css_selector: z.string().nullable().optional(),
  main_content_only: z.boolean().default(true).optional(),
  headless: z.boolean().default(true).optional(),
  network_idle: z.boolean().default(false).optional(),
  wait: z.number().int().min(0).max(15000).default(0).optional(),
  wait_selector: z.string().nullable().optional(),
  wait_selector_state: z
    .enum(['attached', 'detached', 'hidden', 'visible'])
    .default('attached')
    .optional(),
  timeout: z.number().int().positive().default(30000).optional(),
  google_search: z.boolean().default(true).optional(),
  session_id: z.string().nullable().optional(),
} as const;

const stealthyOnly = {
  solve_cloudflare: z.boolean().default(false).optional(),
  hide_canvas: z.boolean().default(false).optional(),
  block_webrtc: z.boolean().default(false).optional(),
} as const;

export const SCRAPLING_TOOL_SCHEMAS = {
  open_session: {
    inputSchema: z.object({
      session_type: z
        .enum(['dynamic', 'stealthy'])
        .describe('"dynamic" = Playwright normal; "stealthy" = bypass anti-bot.'),
      session_id: z.string().nullable().optional(),
      headless: z.boolean().default(true).optional(),
      timeout: z.number().int().positive().default(30000).optional(),
      solve_cloudflare: z.boolean().default(false).optional(),
    }),
  },
  close_session: {
    inputSchema: z.object({
      session_id: z.string(),
    }),
  },
  list_sessions: {
    inputSchema: z.object({}).strict(),
  },
  get: {
    inputSchema: z.object({
      url: z.string().url(),
      ...commonHttpParams,
    }),
  },
  bulk_get: {
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(1).max(20),
      ...commonHttpParams,
    }),
  },
  fetch: {
    inputSchema: z.object({
      url: z.string().url(),
      ...commonBrowserParams,
    }),
  },
  bulk_fetch: {
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(1).max(10),
      ...commonBrowserParams,
    }),
  },
  stealthy_fetch: {
    inputSchema: z.object({
      url: z.string().url(),
      ...commonBrowserParams,
      ...stealthyOnly,
    }),
  },
  bulk_stealthy_fetch: {
    inputSchema: z.object({
      urls: z.array(z.string().url()).min(1).max(10),
      ...commonBrowserParams,
      ...stealthyOnly,
    }),
  },
  screenshot: {
    inputSchema: z.object({
      url: z.string().url(),
      session_id: z
        .string()
        .describe('Debe venir de open_session previo (dynamic o stealthy).'),
      image_type: z.enum(['png', 'jpeg']).default('png').optional(),
      full_page: z.boolean().default(false).optional(),
      wait: z.number().int().min(0).max(15000).default(0).optional(),
      timeout: z.number().int().positive().default(30000).optional(),
    }),
  },
} as const;
