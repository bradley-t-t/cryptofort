<img src="assets/cryptofort-hero.png" width="160" alt="">

# CryptoFort

<p>
  <a href="https://www.npmjs.com/package/cryptofort"><img src="https://img.shields.io/npm/v/cryptofort?color=1f54c9" alt="npm version"></a>
</p>

An encrypted credential vault for Node apps and the AI agents that work on them. API keys, tokens and other secrets go in SQLite, Postgres or Supabase, encrypted with AES-256-GCM. The master key stays in your environment, never in the database.

It comes with an MCP server. By default it can only search and list, so an agent can find the right credential by name, provider or tag but can't read the secret.

<details>
<summary>Features</summary>

- Search and list credentials by name, description, provider or tag, without decrypting anything
- Works with SQLite, Postgres or Supabase
- Namespaces, and optional expiry dates that remove a credential once they pass
- TypeScript types, ESM and CommonJS builds

</details>

<details>
<summary>Install</summary>

```bash
npm install cryptofort
npm install better-sqlite3              # or: postgres, @supabase/supabase-js
npm install @modelcontextprotocol/sdk   # only if you want the MCP server
```

Needs Node 20 or newer. The database drivers and the MCP SDK are optional peer dependencies. Install the ones you use. The package is also on GitHub Packages as `@bradley-t-t/cryptofort`.

Generate a master key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and put it in your environment as `CRYPTOFORT_MASTER_KEY`. If you lose that key, everything it encrypted is gone with it.

</details>

<details>
<summary>Usage</summary>

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

Only `secret` is encrypted. `name`, `description`, `provider`, `tags` and `metadata` are plain text so search works. Don't put anything sensitive in them.

</details>

<details>
<summary>Design</summary>

**Sealing.** Each secret is AES-256-GCM through Web Crypto. Fresh 12-byte IV per write, 16-byte tag in its own column. The additional authenticated data is `namespace\0name`. It's bound into the tag but not stored, so a ciphertext can't be moved. Copy the sealed columns of `staging/db-url` over `production/db-url` and the read fails the tag check instead of handing back the staging secret. Someone with write access can destroy a record but can't swap one in. Records sealed before the binding existed still open without it, and pick it up on their next write.

**Key rotation.** Every record carries a `keyId`. `Crypto` takes a map of old keys for opening and seals new writes with the active one. Rotating is a config change, not a migration.

**Plaintext metadata, on purpose.** Only `secret` is encrypted. Name, provider, tags and metadata stay plain so search and list never touch a key. That's what lets the MCP server describe the vault without a secret ever leaving the database.

**MCP permissions by omission.** Without `--allow-secret-read`, `credential_get` is never registered. No handler checks a flag a model could argue past. The tool just isn't there. Read, write and delete are separate flags because they go wrong differently: a read puts plaintext in a transcript, a bad write can be rewritten, a delete is gone. The intended setup is two servers on one vault: metadata-only for the agent, secret-read for a worker process.

**Expiry** is checked on read. `get` deletes an expired record and returns `null`, and search and list skip it. `purgeExpired()` removes the rows, and the MCP server runs it at startup and every hour. Timestamps are stored as UTC because SQLite compares them as text.

**Adapters** (`src/adapters/`) share one interface. The drivers are optional peer dependencies, so a SQLite user never installs `postgres`.

</details>

<details>
<summary>MCP server</summary>

Point your MCP client at the `cryptofort-mcp` binary:

```json
{
  "mcpServers": {
    "cryptofort": {
      "command": "cryptofort-mcp",
      "env": {
        "CRYPTOFORT_ADAPTER": "sqlite",
        "CRYPTOFORT_SQLITE_PATH": "/absolute/path/to/vault.db",
        "CRYPTOFORT_MASTER_KEY": "<base64-32-bytes>"
      }
    }
  }
}
```

Add flags under `"args"` to turn on more tools:

| Flag                  | Tools                                           |
| :-------------------- | :---------------------------------------------- |
| (none)                | `credential_search`, `credential_list`          |
| `--allow-secret-read` | `credential_get` (returns the decrypted secret) |
| `--allow-write`       | `credential_put`, `credential_purge_expired`    |
| `--allow-delete`      | `credential_delete`                             |

</details>

<details>
<summary>Docs</summary>

The [docs](docs) folder covers [getting started](docs/getting-started.md), [configuration](docs/configuration.md), the [library API](docs/api.md), the [MCP server](docs/mcp.md), [backends](docs/backends.md), the [security model](docs/security.md) and [troubleshooting](docs/troubleshooting.md). To report a security problem, open a [private security advisory](https://github.com/bradley-t-t/cryptofort/security/advisories/new) instead of a public issue. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to work on it.

</details>

Built with TypeScript, Zod and the MCP SDK, bundled with tsup and tested with Vitest.

<details>
<summary>License</summary>

[MIT](LICENSE)

</details>
