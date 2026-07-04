import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape } from 'zod';
import type { Vault } from '../vault.js';

interface ToolResult {
  // Index signature matches the SDK's CallToolResult shape so handlers typecheck.
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
}

interface ToolDef {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });

export function buildTools(vault: Vault, allowWrite: boolean): Record<string, ToolDef> {
  const tools: Record<string, ToolDef> = {
    credential_search: {
      description:
        'Search stored credentials by name, description, provider, or tag. Returns metadata only — never the secret value.',
      schema: {
        query: z.string().describe('Free-text search term'),
        tags: z.array(z.string()).optional(),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        const hits = await vault.search(a.query as string, {
          tags: a.tags as string[] | undefined,
          namespace: a.namespace as string | undefined,
        });
        return text(JSON.stringify(hits, null, 2));
      },
    },
    credential_get: {
      description:
        'Retrieve and decrypt a single credential secret by exact name. Do not print the value into logs or shared output unless the user asked for it.',
      schema: {
        name: z.string().describe('Exact credential name'),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        const secret = await vault.get(a.name as string, {
          namespace: a.namespace as string | undefined,
        });
        return text(secret ?? `not found: ${a.name as string}`);
      },
    },
    credential_list: {
      description:
        'List credential metadata (no secrets) in a namespace, optionally filtered by tag.',
      schema: {
        namespace: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      handler: async (a) => {
        const list = await vault.list({
          namespace: a.namespace as string | undefined,
          tags: a.tags as string[] | undefined,
        });
        return text(JSON.stringify(list, null, 2));
      },
    },
  };

  if (allowWrite) {
    tools.credential_put = {
      description: 'Create or update a credential. Requires the server to run with --allow-write.',
      schema: {
        name: z.string(),
        secret: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        provider: z.string().optional(),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        await vault.put({
          name: a.name as string,
          secret: a.secret as string,
          description: a.description as string | undefined,
          tags: a.tags as string[] | undefined,
          provider: a.provider as string | undefined,
          namespace: a.namespace as string | undefined,
        });
        return text(`stored: ${a.name as string}`);
      },
    };
  }

  return tools;
}

export function buildServer(vault: Vault, allowWrite: boolean): McpServer {
  const server = new McpServer({ name: 'cryptofort', version: '0.1.0' });
  const tools = buildTools(vault, allowWrite);
  for (const [name, def] of Object.entries(tools)) {
    server.tool(name, def.description, def.schema, async (args: Record<string, unknown>) =>
      def.handler(args),
    );
  }
  return server;
}
