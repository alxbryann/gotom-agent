import { createMCPClient } from '@ai-sdk/mcp';

export type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

export async function connectScrapling(): Promise<MCPClient> {
  const url = process.env.SCRAPLING_MCP_URL;
  if (!url) throw new Error('SCRAPLING_MCP_URL not set');

  return createMCPClient({
    transport: {
      type: 'http',
      url,
    },
  });
}
