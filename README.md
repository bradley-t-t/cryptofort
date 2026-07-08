<p align="center">
  <img src="assets/cryptofort-hero.png" width="200" alt="CryptoFort" />
</p>

<h1 align="center">CryptoFort</h1>

<p align="center">
  <b>An encrypted-at-rest credential vault with an MCP server for agents.</b>
</p>
<p align="center">
  AES-256-GCM secrets, a pluggable database backend, and a read-only-by-default<br />
  MCP server — so agents can look up credentials without plaintext ever touching disk.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/cryptofort"><img src="https://img.shields.io/npm/v/cryptofort?style=for-the-badge&color=2563eb&logo=npm&logoColor=white" alt="npm" /></a>
  <a href="https://github.com/bradley-t-t/cryptofort/pkgs/npm/cryptofort"><img src="https://img.shields.io/badge/GitHub%20Packages-@bradley--t--t-2563eb?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Packages" /></a>
  <img src="https://img.shields.io/badge/license-MIT-2563eb?style=for-the-badge" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-2563eb?style=for-the-badge" alt="Node >=20" />
  <img src="https://img.shields.io/badge/AES--256--GCM-encrypted-1f56cf?style=for-the-badge" alt="AES-256-GCM" />
  <img src="https://img.shields.io/badge/MCP-ready-3b82f6?style=for-the-badge" alt="MCP ready" />
</p>

<br />

## Why CryptoFort

Secrets sprawl across `.env` files, shell history, and plaintext columns — and agents have no safe, structured way to ask for them. CryptoFort seals every secret with authenticated encryption, keeps the key out of the database entirely, and hands agents a narrow MCP interface that returns metadata by default and plaintext only on an explicit `get`.

<table width="100%">
  <tr>
    <td width="33%" valign="top">
      <h3 align="center">Encrypted at rest</h3>
      <p align="center">Every secret is sealed with AES-256-GCM. The master key lives only in the environment, so a database dump is inert on its own.</p>
    </td>
    <td width="33%" valign="top">
      <h3 align="center">Agent-native</h3>
      <p align="center">A built-in MCP server exposes <code>search</code>, <code>get</code>, and <code>list</code> — read-only by default, writable only when you opt in.</p>
    </td>
    <td width="33%" valign="top">
      <h3 align="center">Backend-agnostic</h3>
      <p align="center">The same vault runs on Supabase, SQLite, or any Postgres. Switch backends with a single environment variable.</p>
    </td>
  </tr>
</table>

<br />

## Install

```bash
npm install cryptofort
# plus the driver for your backend:
npm install @supabase/supabase-js   # or: better-sqlite3 | postgres
```

<details>
<summary>Install from GitHub Packages instead</summary>

CryptoFort is also published to GitHub Packages as `@bradley-t-t/cryptofort`. Point the `@bradley-t-t` scope at the GitHub registry and authenticate with a token that has `read:packages` — GitHub Packages requires auth even for public packages:

```ini
@bradley-t-t:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

```bash
npm install @bradley-t-t/cryptofort
```

</details>

## Library usage

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
await vault.search('stripe'); // metadata only — never the secret
await vault.get('stripe-secret-key'); // the decrypted secret
```

Generate a master key (base64, 32 bytes):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

…or from the library with `import { generateKey } from 'cryptofort'`.

## MCP server

Point any MCP client at the `cryptofort-mcp` binary:

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

The server is **read-only** by default. Add `"args": ["--allow-write"]` to expose `credential_put`.

### Tools

| Tool                | Access | Description                                                           |
| :------------------ | :----- | :-------------------------------------------------------------------- |
| `credential_search` | read   | Search by name, description, provider, or tag. Returns metadata only. |
| `credential_get`    | read   | Decrypt and return a single secret by exact name.                     |
| `credential_list`   | read   | List credential metadata in a namespace, optionally filtered by tag.  |
| `credential_put`    | write  | Create or update a credential. Requires `--allow-write`.              |

### Environment

| Variable                                     | Required | Purpose                                                     |
| :------------------------------------------- | :------- | :---------------------------------------------------------- |
| `CRYPTOFORT_MASTER_KEY`                      | always   | Base64, 32-byte AES-256 key. Never written to the database. |
| `CRYPTOFORT_ADAPTER`                         | —        | `supabase` (default), `sqlite`, or `postgres`.              |
| `CRYPTOFORT_KEY_ID`                          | —        | Key identifier for rotation. Defaults to `default`.         |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Connection for the Supabase adapter.                        |
| `CRYPTOFORT_SUPABASE_DB_URL`                 | —        | Direct Postgres URL, used only to auto-create the schema.   |
| `CRYPTOFORT_POSTGRES_URL`                    | Postgres | Connection string for the Postgres adapter.                 |
| `CRYPTOFORT_SQLITE_PATH`                     | —        | SQLite file path. Defaults to `cryptofort.db`.              |

## Backends

| Backend      | Driver                  | Best for                                                  |
| :----------- | :---------------------- | :-------------------------------------------------------- |
| **Supabase** | `@supabase/supabase-js` | Hosted, shared across agents, service-role access.        |
| **Postgres** | `postgres`              | Dropping the vault into existing Postgres infrastructure. |
| **SQLite**   | `better-sqlite3`        | Local, single-process, zero-infrastructure use.           |

## How it works

- Only the secret is ciphertext. `name`, `description`, `provider`, and `tags` stay plaintext, so search and listing work without ever decrypting.
- Each secret is sealed with **AES-256-GCM** — authenticated encryption, so any tampering is caught on read.
- The **master key never touches the database.** It lives only in `CRYPTOFORT_MASTER_KEY`; a stolen dump reveals nothing without it.
- The MCP server refuses writes unless started with `--allow-write`, so an agent can look secrets up but cannot quietly rewrite the vault.

## Schema

CryptoFort creates its schema automatically on first connect — one table, one ciphertext column, the rest plaintext metadata for search. There is no migration to run by hand.

- **SQLite** and **Postgres**: `adapter.init()` issues `create table if not exists` (plus indexes), so pointing CryptoFort at an empty database is enough.
- **Supabase**: the client speaks PostgREST, which cannot run DDL. `init()` probes for the table and, when it is missing, creates it through a direct Postgres connection given in `CRYPTOFORT_SUPABASE_DB_URL`. If the table already exists the probe is a no-op; if it is missing and no DB URL is set, `init()` fails with a clear message instead of silently.

The canonical column definitions live in [`src/adapters/schema.ts`](src/adapters/schema.ts).

## Development

```bash
npm run build      # bundle with tsup
npm test           # run the vitest suite
npm run typecheck  # tsc --noEmit
```

## License

Released under the MIT License.

<br />

<p align="center">
  <sub>Secrets sealed at rest — handed to agents, never spilled.</sub>
</p>
