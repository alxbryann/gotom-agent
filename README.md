# gotom-agent

AI agent backend for GoTom — entrevista + prospección con **dos integraciones distintas**:

| Integración | Variable | Para qué |
|-------------|----------|----------|
| **Scrapling MCP** | `SCRAPLING_MCP_URL` | Scraping web (GET, Playwright, anti-bot, etc.). Tu servicio desplegado. |
| **Google Places** | `GOOGLE_PLACES_API_KEY` | Tool `find_local_businesses` — listados locales por categoría/zona (API de Google, no es scrape). |

No mezcles los nombres: la env es **`SCRAPLING_MCP_URL`** (con **S**), no `CRAPLING_*`.

## Stack
- Hono + Node 22
- Vercel AI SDK v5 (`ai`, `@ai-sdk/deepseek`, `@ai-sdk/mcp`)
- DeepSeek
- Scrapling MCP vía HTTP (`SCRAPLING_MCP_URL`)

## Setup
```bash
cp .env.example .env   # DEEPSEEK_API_KEY; ajusta SCRAPLING_MCP_URL y GOOGLE_PLACES_API_KEY según uses
npm install
npm run dev
```

## Endpoints
- `GET  /api/health`
- `POST /api/chat` — body: `{ messages: UIMessage[] }`, devuelve UI message stream (compatible con `useChat` de `@ai-sdk/react`)
- `POST /api/prospect-sim` — práctica de ventas: body `{ messages, simulationContext }` (contexto de battlecards + pitch). Sin tools; solo rol prospecto con DeepSeek.

## Tools del agente
- **Scrapling** (tools del MCP): cuando el usuario pide scrapear URLs, sector en web, competidores en sitio, etc. Requiere `SCRAPLING_MCP_URL` accesible desde el agente.
- **`find_local_businesses`**: solo Places; requiere `GOOGLE_PLACES_API_KEY`.

Si `SCRAPLING_MCP_URL` está vacía o el MCP no responde, el agente sigue sin tools de scrape (solo Places + chat). Revisa logs `[chat] Scrapling MCP omitido`.

### Google Places
1. Proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. Habilitar **Places API** (API nueva).
3. Credenciales → API key.
4. `GOOGLE_PLACES_API_KEY` en `.env` del **gotom-agent** y reiniciar.
