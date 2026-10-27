<p align="center"><img src="assets/cryptofort-hero.png" width="160" alt=""></p>
<h1 align="center">CryptoFort</h1>
<p align="center">An encrypted credential vault for Node, with an MCP server that lets agents find credentials without seeing them.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/cryptofort"><img src="https://img.shields.io/npm/v/cryptofort?color=1f54c9" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1f54c9" alt="MIT license"></a>
</p>

CryptoFort keeps API keys, tokens and other secrets in SQLite, Postgres or Supabase, encrypted with AES-256-GCM. The master key lives in your environment and never goes in the database.

It also comes with an MCP server. By default it can only search and list the vault, so an agent can find the right credential by name, provider or tag but can't read the secret.

## Features

- Search and list credentials by name, description, provider or tag, without decrypting anything
- Works with SQLite, Postgres or Supabase
- Namespaces, and optional expiry dates that remove a credential once they pass
- MCP server that's read-only by default. Reading secrets, writing and deleting each need their own flag.
- TypeScript types, ESM and CommonJS builds

## Install

```bash
npm install cryptofort
npm install better-sqlite3              # or: postgres, @supabase/supabase-js
npm install @modelcontextprotocol/sdk   # only if you want the MCP server
```

Needs Node 20 or newer. The database drivers and the MCP SDK are optional peer dependencies, so you only install the ones you use. The package is also on GitHub Packages as `@bradley-t-t/cryptofort`.

Generate a master key and put it in your environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
export CRYPTOFORT_MASTER_KEY='the-value-you-just-generated'
```

If you lose that key, everything it encrypted is gone with it.

## Usage

```ts
import { Vault, Crypto, SqliteAdapter } from 'cryptofort';

const adapter = new SqliteAdapter('vault.db');
await adapter.init();

const vault = new Vault({
  adapter,
  crypto: new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! }),
});

await vault.put({
  name: 'stripe-secret-key',
  secret: 'sk_live_…',
  provider: 'stripe',
  tags: ['payments'],
});
await vault.search('stripe'); // metadata only, no secret
await vault.get('stripe-secret-key'); // the decrypted secret
```

Only `secret` is encrypted. `name`, `description`, `provider`, `tags` and `metadata` are stored in plain text so search works, so don't put anything sensitive in them.

## MCP server

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

## Docs

- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md) (environment variables)
- [Library API](docs/api.md)
- [MCP server](docs/mcp.md)
- [Backends](docs/backends.md)
- [Security model](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, open a [private security advisory](https://github.com/bradley-t-t/cryptofort/security/advisories/new) instead of a public issue. [SECURITY.md](SECURITY.md) has the details.

## License

[MIT](LICENSE)
