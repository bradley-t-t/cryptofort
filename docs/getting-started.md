# Getting started

This page takes you from an empty project to a working vault, then to an MCP
client that can search it.

**Requires Node 20 or newer.**

## 1. Install

```bash
npm install cryptofort
```

CryptoFort ships with no database driver of its own. Install the one for the
backend you want — they are optional peer dependencies, so nothing is pulled in
that you do not use:

```bash
npm install better-sqlite3          # local file, zero infrastructure
npm install postgres                # any Postgres
npm install @supabase/supabase-js   # hosted Supabase
```

And, if you want the MCP server:

```bash
npm install @modelcontextprotocol/sdk
```

Start with SQLite if you are just trying CryptoFort out. Nothing has to be
running and the vault is a single file.

## 2. Generate a master key

The key is 32 random bytes, base64-encoded. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

or from the library:

```ts
import { generateKey } from 'cryptofort';
console.log(generateKey());
```

Put it in your environment, not in your code:

```bash
export CRYPTOFORT_MASTER_KEY='the-base64-value-you-just-generated'
```

This key is the whole of the vault's security. If it leaks, every secret it
sealed is readable; if it is lost, every secret it sealed is unrecoverable.
Keep it in a secret manager or your host's environment settings, use a different
one per environment, and never commit it. See [the security model](security.md).

## 3. Store and read a credential

```ts
import { Vault, Crypto, SqliteAdapter } from 'cryptofort';

const adapter = new SqliteAdapter('vault.db');
await adapter.init(); // creates the table if it is not there — idempotent

const vault = new Vault({
  adapter,
  crypto: new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! }),
});

await vault.put({
  name: 'stripe-secret-key',
  secret: 'sk_live_51H…',
  description: 'Live payments key for the checkout service',
  provider: 'stripe',
  tags: ['payments', 'production'],
});

// Metadata only — the secret is not in this result.
console.log(await vault.search('stripe'));

// The decrypted secret.
const key = await vault.get('stripe-secret-key');
```

`put` creates or updates: calling it again with the same `name` re-seals the
secret and patches only the fields you passed. `get` returns `null` when there
is no such credential rather than throwing.

**`description`, `provider`, and `tags` are stored in plaintext** so that
`search` can work without decrypting anything. Describe the credential in them;
never restate the secret.

## 4. Give a credential an expiry

```ts
await vault.put({
  name: 'ci-deploy-token',
  secret: 'ghp_…',
  expiresAt: '2026-12-31T00:00:00Z', // ISO 8601
});
```

Once that instant passes the credential is dead everywhere at once: `get`
deletes it and returns `null`, and `search` and `list` stop showing it — before
any sweep has physically removed the row.

`purgeExpired()` does the physical cleanup and returns how many rows it deleted:

```ts
const deleted = await vault.purgeExpired();
```

Call it on whatever schedule suits your app. The MCP server runs it for you, at
startup and hourly. Pass `expiresAt: null` to a later `put` to clear an expiry.

## 5. Organise with namespaces

Every credential lives in a namespace, defaulting to `default`:

```ts
await vault.put({ name: 'db-url', secret: 'postgres://…', namespace: 'staging' });
await vault.get('db-url', { namespace: 'staging' });
```

`(namespace, name)` is the unique key, so the same name can exist in several
namespaces without collision, and a sealed secret is cryptographically bound to
the pair — a ciphertext cannot be moved between namespaces without failing to
open.

Note the asymmetry: `put`, `get`, and `remove` default to the `default`
namespace, while `search` and `list` span **all** namespaces unless you pass
one.

Namespaces organise credentials. They are not a permission boundary — see
[the security model](security.md).

## 6. Point an MCP client at it

Add CryptoFort to your MCP client's configuration. This example uses SQLite:

```json
{
  "mcpServers": {
    "cryptofort": {
      "command": "cryptofort-mcp",
      "env": {
        "CRYPTOFORT_ADAPTER": "sqlite",
        "CRYPTOFORT_SQLITE_PATH": "/absolute/path/to/vault.db",
        "CRYPTOFORT_MASTER_KEY": "the-base64-value"
      }
    }
  }
}
```

As configured, the agent can call `credential_search` and `credential_list` —
it can describe what the vault holds and change nothing in it. That is the
default, and for a conversational agent it is usually the right one: a secret
handed to a chat session is written into a transcript that outlives the
operation it was fetched for.

To go further, add flags:

```json
"args": ["--allow-write"]
```

`--allow-secret-read` exposes `credential_get`, `--allow-write` exposes
`credential_put` and `credential_purge_expired`, and `--allow-delete` exposes
`credential_delete`. A permission you do not give means the tool is never
registered, so it cannot be called at all. [The MCP page](mcp.md) covers each
one and when to use it.

## Where to go next

- [Configuration](configuration.md) — every environment variable.
- [Backends](backends.md) — moving off SQLite to Postgres or Supabase.
- [Library API](api.md) — the full surface.
- [MCP server](mcp.md) — the tools and the permission model.
- [Security model](security.md) — what this protects you from, and what it does not.
