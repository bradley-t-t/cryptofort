# Backends

The same vault runs on Supabase, Postgres, or SQLite. The adapter is the only
thing that changes; the encryption, the expiry rules, and the MCP surface are
identical across all three, and an adapter never sees a plaintext secret.

| Backend      | Driver                  | Best for                                                  |
| :----------- | :---------------------- | :-------------------------------------------------------- |
| **Supabase** | `@supabase/supabase-js` | Hosted, shared across agents, service-role access.        |
| **Postgres** | `postgres`              | Dropping the vault into existing Postgres infrastructure. |
| **SQLite**   | `better-sqlite3`        | Local, single-process, zero-infrastructure use.           |

Every driver is an **optional peer dependency**. Install only the one you use.

## The schema

CryptoFort creates its own schema on first connect. There is no migration to run
by hand. One table, `cryptofort_credentials`:

| Column                                         | Holds                                                      |
| :--------------------------------------------- | :--------------------------------------------------------- |
| `id`                                           | UUID primary key.                                          |
| `namespace`, `name`                            | Unique together. The record's identity.                    |
| `description`, `provider`, `tags`              | Plaintext metadata, searchable.                            |
| `metadata`                                     | Free-form JSON. Plaintext.                                 |
| `created_at`, `updated_at`                     | ISO 8601 timestamps.                                       |
| `last_accessed_at`                             | When the secret was last decrypted. Nullable.              |
| `expires_at`                                   | When set, the record dies at this instant. Nullable.       |
| `secret_ciphertext`, `secret_iv`, `secret_tag` | The sealed secret. Base64. **The only encrypted columns.** |
| `key_id`                                       | Which key sealed it, for rotation.                         |

On Postgres and Supabase, an index on `namespace` and a GIN index on `tags`.

The canonical definitions live in
[`src/adapters/schema.ts`](../src/adapters/schema.ts) rather than in a `.sql`
file, so the package can provision itself and a fresh database just works.

`init()` is idempotent on every backend — it creates what is missing and does
nothing when everything is there — so calling it on each startup is correct. It
also applies the additive migrations for columns introduced after the first
release, so an older vault is brought up to date rather than failing.

## SQLite

The simplest way to run CryptoFort. A single file, no server.

```bash
npm install better-sqlite3
```

```ts
import { Vault, Crypto, SqliteAdapter } from 'cryptofort';

const adapter = new SqliteAdapter('/var/lib/cryptofort/vault.db');
await adapter.init();

const vault = new Vault({
  adapter,
  crypto: new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! }),
});
```

Via the MCP server:

```bash
CRYPTOFORT_ADAPTER=sqlite
CRYPTOFORT_SQLITE_PATH=/var/lib/cryptofort/vault.db   # default: cryptofort.db
```

Notes:

- `better-sqlite3` is a **native module** and compiles on install. That is the
  usual source of install trouble on an unusual platform or a fresh container.
- The driver is imported lazily inside `init()`, so importing CryptoFort for a
  different backend does not require it to be present.
- `CRYPTOFORT_SQLITE_PATH` is exempt from the printable-ASCII rule applied to
  other variables — a path can legitimately contain spaces and accents.
- **Use an absolute path** under the MCP server. The working directory is the
  client's, and a relative path creates an empty vault wherever that happens to
  be.
- SQLite has no array or JSON column type here, so `tags` and `metadata` are
  stored as JSON text. The adapter encodes and decodes them for you.
- The file is as private as its permissions. It holds ciphertext, so it is not a
  catastrophe on its own, but there is no reason to leave it world-readable.
- It is a single-writer database. Fine for one process; not the choice for
  several agents sharing a vault.

## Postgres

For dropping the vault into infrastructure you already run.

```bash
npm install postgres
```

```ts
import postgres from 'postgres';
import { Vault, Crypto, PostgresAdapter } from 'cryptofort';

const sql = postgres(process.env.DATABASE_URL!);
const adapter = new PostgresAdapter(sql);
await adapter.init(); // create table if not exists, plus indexes
```

Via the MCP server:

```bash
CRYPTOFORT_ADAPTER=postgres
CRYPTOFORT_POSTGRES_URL=postgres://user:pass@host:5432/dbname
```

Notes:

- The adapter takes an **already-constructed client**, so pooling, TLS, and
  timeouts stay yours to configure. The MCP server builds a default one from the
  connection string.
- `init()` issues `create table if not exists` plus its indexes and additive
  migrations, so pointing CryptoFort at an empty database is enough. The role
  needs create privileges on first run; after that, read and write suffice.
- `gen_random_uuid()` is used as the `id` default. It is built in on Postgres 13
  and newer.
- Nothing stops you keeping the vault in a schema or database of its own, and
  there are good reasons to: it limits what a compromised application role can
  reach.

## Supabase

For a hosted vault several agents can share.

```bash
npm install @supabase/supabase-js
```

```bash
CRYPTOFORT_ADAPTER=supabase          # this is the default
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
CRYPTOFORT_SUPABASE_DB_URL=postgres://postgres:<pass>@db.<ref>.supabase.co:5432/postgres
```

### Why there is a second connection string

The Supabase client speaks PostgREST, which **cannot run DDL**. So `init()`
probes for the table (and for the newest column) through PostgREST, and when
something is missing it creates it through a direct Postgres connection given in
`CRYPTOFORT_SUPABASE_DB_URL`. That variable is used for schema work and nothing
else — every read and write goes through the Supabase client.

What happens on `init()`:

| Situation                                          | Result                                                          |
| :------------------------------------------------- | :-------------------------------------------------------------- |
| Table exists and is current                        | A cheap probe, then a no-op.                                    |
| Table missing, `CRYPTOFORT_SUPABASE_DB_URL` set    | Table, indexes, and RLS are created.                            |
| Table missing, no DB URL                           | Throws, naming the variable to set. It does not fail silently.  |
| Table exists but predates `expires_at`, DB URL set | The column is added.                                            |
| Same, but no DB URL                                | Warns on stderr and continues — the vault works minus expiry.   |
| Any other error (auth, network)                    | Warns and continues, so a real problem is not provisioned over. |

The provisioning connection needs the `postgres` driver installed as well. The
MCP server closes it once the DDL is done rather than holding an idle pool open.

Once the schema exists you can drop `CRYPTOFORT_SUPABASE_DB_URL` entirely, and
there is a good argument for doing so: it is a full-privilege database
credential that is not needed at steady state.

### Service role, and why

The **service-role key** is required. The anon key cannot write this table, and
CryptoFort is a server-side component — a service-role key in a browser is a
full database compromise, so never ship one to a client.

`init()` enables row-level security on the table as defense in depth: with no
policies, the anon key can read nothing. The real protection is the app-level
AES-256-GCM, since the rows hold ciphertext either way, and RLS is harmless on a
table the service role owns.

### Creating the table by hand

If you would rather not hand CryptoFort a direct database URL, run this once in
the SQL editor and leave `CRYPTOFORT_SUPABASE_DB_URL` unset:

```sql
create table if not exists cryptofort_credentials (
  id uuid primary key default gen_random_uuid(),
  namespace text not null default 'default',
  name text not null,
  description text,
  tags text[] not null default '{}',
  provider text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  expires_at timestamptz,
  secret_ciphertext text not null,
  secret_iv text not null,
  secret_tag text not null,
  key_id text not null default 'default',
  unique (namespace, name)
);

create index if not exists cryptofort_credentials_namespace_idx
  on cryptofort_credentials (namespace);
create index if not exists cryptofort_credentials_tags_idx
  on cryptofort_credentials using gin (tags);

alter table cryptofort_credentials enable row level security;
```

Keep it in step with
[`src/adapters/schema.ts`](../src/adapters/schema.ts), which is the source of
truth.

## Differences worth knowing

The adapters are interchangeable for everything the vault does, with three
exceptions:

1. **Free-text search reaches tags on SQLite only.** All three match the query
   against `name`, `description`, and `provider`. SQLite also matches it against
   the JSON-encoded tag text, so a query that happens to name a tag returns more
   rows there than it would on Postgres or Supabase. Filter by tag with the
   `tags` option, which behaves identically everywhere.
2. **An unlimited search is capped on Postgres.** With no `limit`, the Postgres
   adapter applies one of 1000. SQLite applies none. The Supabase adapter
   applies none either, but PostgREST enforces its own maximum row count on the
   server, so a large result can still come back short. Pass an explicit `limit`
   whenever the exact number matters to you.
3. **Timestamps are typed differently.** Postgres and Supabase use `timestamptz`;
   SQLite stores ISO 8601 text and compares it as text. The vault normalizes
   every timestamp to canonical UTC before storing precisely so that textual
   comparison still orders chronologically — which is why an adapter of your own
   must do the same.

## Moving between backends

There is no export command. Read from one vault and write to another with both
constructed in the same process:

```ts
import { Vault, Crypto, SqliteAdapter, PostgresAdapter } from 'cryptofort';
import postgres from 'postgres';

const crypto = new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! });

const from = new SqliteAdapter('vault.db');
await from.init();
const to = new PostgresAdapter(postgres(process.env.DATABASE_URL!));
await to.init();

const source = new Vault({ adapter: from, crypto });
const target = new Vault({ adapter: to, crypto });

for (const meta of await source.list()) {
  const secret = await source.get(meta.name, { namespace: meta.namespace });
  if (secret === null) continue; // expired between the list and the read
  await target.put({
    name: meta.name,
    secret,
    namespace: meta.namespace,
    description: meta.description ?? undefined,
    provider: meta.provider ?? undefined,
    tags: meta.tags,
    metadata: meta.metadata,
    expiresAt: meta.expiresAt,
  });
}
```

Every secret passes through plaintext in that process, so run it somewhere you
would be willing to hold them all at once, and do not log the loop.
