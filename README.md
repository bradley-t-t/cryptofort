# CryptoFort

Encrypted-at-rest credential vault with pluggable database backends and an MCP
server so agents can look up secrets.

- **Encrypted at rest** — AES-256-GCM. The master key lives only in the
  environment; a database dump is useless without it.
- **Pluggable backends** — Supabase, SQLite, or any Postgres.
- **Agent-native** — ships an MCP server exposing `credential_search`,
  `credential_get`, `credential_list` (read-only by default).

## Install

```bash
npm install cryptofort
# plus the driver for your backend:
npm install @supabase/supabase-js   # or: better-sqlite3 | postgres
```

## Library usage

```ts
import { Vault, Crypto, SqliteAdapter, generateKey } from 'cryptofort';

const adapter = new SqliteAdapter('vault.db');
await adapter.init();
const vault = new Vault({ adapter, crypto: new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! }) });

await vault.put({ name: 'stripe-secret-key', secret: 'sk_live_…', provider: 'stripe', tags: ['payments'] });
await vault.search('stripe'); // metadata only
await vault.get('stripe-secret-key'); // decrypted secret
```

Generate a master key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
(or `import { generateKey } from 'cryptofort'`).

## MCP server

```json
{
  "mcpServers": {
    "cryptofort": {
      "command": "cryptofort-mcp",
      "env": {
        "CRYPTOFORT_ADAPTER": "supabase",
        "SUPABASE_URL": "https://<ref>.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>",
        "CRYPTOFORT_MASTER_KEY": "<base64-32-bytes>"
      }
    }
  }
}
```

Add `"args": ["--allow-write"]` to expose the `credential_put` tool. Omit it to
keep the server read-only.

### Environment variables

| var | purpose |
|-----|---------|
| `CRYPTOFORT_MASTER_KEY` | base64 32-byte AES key (required) |
| `CRYPTOFORT_ADAPTER` | `supabase` \| `sqlite` \| `postgres` (default `supabase`) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase adapter |
| `CRYPTOFORT_POSTGRES_URL` | Postgres adapter connection string |
| `CRYPTOFORT_SQLITE_PATH` | SQLite file path (default `cryptofort.db`) |

## Schema

See `sql/001_cryptofort_credentials.sql`. Only the secret is ciphertext; name,
description, provider, and tags are plaintext so search works.

## License

MIT
