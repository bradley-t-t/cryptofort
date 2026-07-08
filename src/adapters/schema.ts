// Canonical CryptoFort schema, expressed in code so no `.sql` file ships with
// the package. Each adapter builds its store from these definitions on first
// connect (see the `init()` implementations), so a fresh database is created
// automatically instead of requiring the user to run a migration by hand.

export const TABLE = 'cryptofort_credentials';

// Postgres / Supabase table. `gen_random_uuid()` lets the database fill `id`
// if a caller ever omits one; the vault also generates ids client-side.
export const POSTGRES_TABLE_DDL = `
  create table if not exists ${TABLE} (
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
    secret_ciphertext text not null,
    secret_iv text not null,
    secret_tag text not null,
    key_id text not null default 'default',
    unique (namespace, name)
  )`;

export const POSTGRES_INDEX_DDL = [
  `create index if not exists ${TABLE}_namespace_idx on ${TABLE} (namespace)`,
  `create index if not exists ${TABLE}_tags_idx on ${TABLE} using gin (tags)`,
];

// Supabase deployments enable RLS as defense-in-depth: with no policies the
// anon key can read nothing. The real protection is app-level AES-256-GCM —
// secrets are ciphertext at rest. Harmless on a table the service role owns.
export const POSTGRES_RLS_DDL = `alter table ${TABLE} enable row level security`;

// SQLite mirrors the Postgres columns with SQLite-native types (text ids,
// JSON-encoded tags/metadata).
export const SQLITE_TABLE_DDL = `
  create table if not exists ${TABLE} (
    id text primary key,
    namespace text not null default 'default',
    name text not null,
    description text,
    tags text not null default '[]',
    provider text,
    metadata text not null default '{}',
    created_at text not null,
    updated_at text not null,
    last_accessed_at text,
    secret_ciphertext text not null,
    secret_iv text not null,
    secret_tag text not null,
    key_id text not null default 'default',
    unique (namespace, name)
  )`;
