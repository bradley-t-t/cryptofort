<img src="assets/cryptofort-hero.png" width="160" alt="">

# CryptoFort

<p>
  <a href="https://www.npmjs.com/package/cryptofort"><img src="https://img.shields.io/npm/v/cryptofort?color=1f54c9" alt="npm version"></a>
</p>

An encrypted credential vault for Node apps and the AI agents that work on them. API keys, tokens and other secrets go in SQLite, Postgres or Supabase, encrypted with AES-256-GCM. The master key stays in your environment, never in the database. Credentials can be split into namespaces and given an expiry date, and the package ships TypeScript types with ESM and CommonJS builds.

It comes with an MCP server. By default it can only search and list, so an agent can find the right credential by name, provider or tag but can't read the secret.

## Install

```bash
npm install cryptofort
npm install better-sqlite3              # or: postgres, @supabase/supabase-js
npm install @modelcontextprotocol/sdk   # only if you want the MCP server
```

Needs Node 22 or newer. The database drivers and the MCP SDK are optional peer dependencies, so install only the ones you use. It's also on GitHub Packages as `@bradley-t-t/cryptofort`.

Make a master key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and set it as `CRYPTOFORT_MASTER_KEY`. If you lose that key, everything it encrypted is gone with it.

```ts
import { Vault, Crypto, SqliteAdapter } from 'cryptofort';

const adapter = new SqliteAdapter('vault.db');
await adapter.init();

const vault = new Vault({
  adapter,
  crypto: new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! }),
});

await vault.put({ name: 'stripe-secret-key', secret: 'sk_live_…', provider: 'stripe' });
await vault.search('stripe'); // metadata only, no secret
await vault.get('stripe-secret-key'); // the decrypted secret
```

Only `secret` is encrypted. `name`, `description`, `provider`, `tags` and `metadata` stay plain text so search and list never need a key, which is also how the MCP server can describe the vault without a secret leaving the database. Don't put anything sensitive in them.

## Giving it to an agent

Keep the master key in a file only you can read, and start the `cryptofort-mcp` binary from a small launcher that loads it:

```bash
# ~/.cryptofort.env, chmod 600
CRYPTOFORT_ADAPTER=sqlite
CRYPTOFORT_SQLITE_PATH=/absolute/path/to/vault.db
CRYPTOFORT_MASTER_KEY=<base64-32-bytes>
```

```bash
#!/usr/bin/env bash
# ~/bin/cryptofort-mcp-launch, chmod 700
set -a; . "$HOME/.cryptofort.env"; set +a
exec cryptofort-mcp "$@"
```

Then point your MCP client at the launcher:

```json
{
  "mcpServers": {
    "cryptofort": { "command": "/Users/you/bin/cryptofort-mcp-launch" }
  }
}
```

The key could go in the client config's `env` block instead, but client configs get synced, shared and committed, and anything in that file goes with them.

Flags under `"args"` turn on more tools:

| Flag                  | Tools                                           |
| :-------------------- | :---------------------------------------------- |
| (none)                | `credential_search`, `credential_list`          |
| `--allow-secret-read` | `credential_get` (returns the decrypted secret) |
| `--allow-write`       | `credential_put`, `credential_purge_expired`    |
| `--allow-delete`      | `credential_delete`                             |

Without `--allow-secret-read`, `credential_get` is never registered. There's no handler checking a flag that a model could argue past. The tool just isn't there. Read, write and delete are separate because they go wrong differently. A read puts plaintext in a transcript, a bad write can be rewritten, and a delete is gone. The setup it was made for is two servers on one vault, metadata-only for the agent and secret-read for a worker process.

## Using a credential without seeing it

Once the agent knows which credential a job needs, `cryptofort run` hands it to the command that does the job instead of to the agent:

```bash
cryptofort run --env-file ~/.cryptofort.env stripe-secret-key -- node scripts/refund.js
```

The script reads `STRIPE_SECRET_KEY` from its environment. Nothing is printed, so the value stays off the command line, out of shell history and out of the agent's transcript. The command doesn't inherit the master key or any other variable that opens the vault. It can still print what it was given, so this keeps a secret away from an agent that runs trusted scripts, not one that writes its own. [Running commands](docs/run.md) covers the options and exit codes.

## Why it's built this way

Each secret is sealed through Web Crypto with a fresh 12-byte IV per write and the 16-byte tag in its own column. The additional authenticated data is `namespace\0name`. It's bound into the tag but not stored, so a ciphertext can't be moved. Copy the sealed columns of `staging/db-url` over `production/db-url` and the read fails the tag check instead of handing back the staging secret. Someone with write access can destroy a record but can't swap one in. Records sealed before the binding existed still open without it and pick it up on their next write.

Every record carries a `keyId`. `Crypto` takes a map of old keys for opening and seals new writes with the active one, so rotating a key is a config change, not a migration.

Expiry is checked on read. `get` deletes an expired record and returns `null`, and search and list skip it. `purgeExpired()` removes the rows, and the MCP server runs it at startup and every hour. Timestamps are stored as UTC because SQLite compares them as text.

The adapters in `src/adapters/` share one interface, and the drivers are optional so a SQLite user never installs `postgres`.

The [docs](docs) folder has [getting started](docs/getting-started.md), [configuration](docs/configuration.md), [running commands](docs/run.md), the [library API](docs/api.md), the [MCP server](docs/mcp.md), [backends](docs/backends.md), the [security model](docs/security.md) and [troubleshooting](docs/troubleshooting.md). Report security problems through a [private security advisory](https://github.com/bradley-t-t/cryptofort/security/advisories/new), not a public issue. [CONTRIBUTING.md](CONTRIBUTING.md) covers working on it.

Built with TypeScript, Zod and the MCP SDK, bundled with tsup and tested with Vitest. [MIT](LICENSE) licensed.
