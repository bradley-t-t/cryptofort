import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodRawShape } from 'zod';
import type { Vault } from '../vault.js';

// Replaced at bundle time from package.json. Running from source (tests) leaves
// it undeclared, and a build that reports a version it is not is worse than one
// that says it does not know.
declare const __CRYPTOFORT_VERSION__: string | undefined;
const VERSION = typeof __CRYPTOFORT_VERSION__ === 'string' ? __CRYPTOFORT_VERSION__ : '0.0.0-dev';

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

export interface ToolAccess {
  /**
   * Register `credential_get`, the only tool that hands a decrypted secret back
   * to its caller. Off by default: whatever a conversational agent is given, it
   * has written into its own transcript, so a secret read this way outlives by
   * weeks the operation it was fetched for. A process that needs the value
   * itself opens its own session with this on and passes it to a child through
   * the environment, where nothing renders it.
   */
  allowSecretRead?: boolean;
  /** Register `credential_put` and `credential_purge_expired`. */
  allowWrite?: boolean;
  /**
   * Register `credential_delete`. Separate from write because it is the one
   * operation the vault cannot answer for afterwards: a put can be put again
   * and a purge only removes what an expiry already killed, while a delete
   * leaves nothing to recover from. A caller that stores credentials should not
   * have to hold the permission that loses them.
   */
  allowDelete?: boolean;
}

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });

/**
 * The tools this server exposes, given what the caller is allowed to do.
 *
 * Access is enforced by omission rather than by a check inside a handler: a
 * server built without a permission never registers the tools it covers, so a
 * caller cannot reach them at all and does not have to be trusted to respect a
 * refusal. Search and list are always present — they carry metadata only.
 */
export function buildTools(vault: Vault, access: ToolAccess = {}): Record<string, ToolDef> {
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

  if (access.allowSecretRead) {
    tools.credential_get = {
      description:
        'Retrieve and decrypt a single credential secret by exact name. Requires the server to run with --allow-secret-read. Use the value in the operation that needs it; never print it into logs, files, or any shared output.',
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
    };
  }

  if (access.allowWrite) {
    tools.credential_put = {
      description: 'Create or update a credential. Requires the server to run with --allow-write.',
      schema: {
        name: z.string(),
        secret: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        provider: z.string().optional(),
        namespace: z.string().optional(),
        expiresAt: z
          .string()
          .nullable()
          .optional()
          .describe(
            'ISO 8601 timestamp after which the credential is deleted automatically. Pass null to clear an existing expiry.',
          ),
      },
      handler: async (a) => {
        await vault.put({
          name: a.name as string,
          secret: a.secret as string,
          description: a.description as string | undefined,
          tags: a.tags as string[] | undefined,
          provider: a.provider as string | undefined,
          namespace: a.namespace as string | undefined,
          expiresAt: a.expiresAt as string | null | undefined,
        });
        return text(`stored: ${a.name as string}`);
      },
    };

    tools.credential_purge_expired = {
      description:
        'Permanently delete every credential whose expiry time has passed, across all namespaces. Requires the server to run with --allow-write.',
      schema: {},
      handler: async () => {
        const purged = await vault.purgeExpired();
        return text(`purged: ${purged} expired credential${purged === 1 ? '' : 's'}`);
      },
    };
  }

  if (access.allowDelete) {
    tools.credential_delete = {
      description:
        'Permanently delete a credential by exact name. The secret is gone — there is no undo and no copy kept. Requires the server to run with --allow-delete.',
      schema: {
        name: z.string().describe('Exact credential name'),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        const name = a.name as string;
        const deleted = await vault.remove(name, {
          namespace: a.namespace as string | undefined,
        });
        return text(deleted ? `deleted: ${name}` : `not found: ${name}`);
      },
    };
  }

  return tools;
}

export function buildServer(vault: Vault, access: ToolAccess = {}): McpServer {
  const server = new McpServer({ name: 'cryptofort', version: VERSION });
  const tools = buildTools(vault, access);
  for (const [name, def] of Object.entries(tools)) {
    server.tool(name, def.description, def.schema, async (args: Record<string, unknown>) =>
      def.handler(args),
    );
  }
  return server;
}
