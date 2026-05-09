# gotom-agent

AI agent backend for GoTom — entrevista al usuario sobre su negocio y ejecuta prospección via Scrapling MCP + Google Places.

## Stack
- Hono + Node 22
- Vercel AI SDK v5 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/mcp`)
- Claude Sonnet 4.6
- Scrapling MCP (HTTP) en `52.15.192.69:8000/mcp`

## Setup
```bash
cp .env.example .env  # añadir ANTHROPIC_API_KEY
npm install
npm run dev
```

## Endpoints
- `GET  /api/health`
- `POST /api/chat` — body: `{ messages: UIMessage[] }`, devuelve UI message stream (compatible con `useChat` de `@ai-sdk/react`)

## Tools del agente
- Todas las de Scrapling MCP (`get`, `fetch`, `stealthy_fetch`, `screenshot`, etc.)
- `find_local_businesses` — Google Places (requiere `GOOGLE_PLACES_API_KEY`)
