// Schema lives in code rather than a `.sql` file so the package can provision
// itself: each adapter's init() applies these on first connect and a fresh
// database just works, with no migration step for the user to run.

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
    expires_at timestamptz,
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

// Columns added after the first release. Tables built before them exist won't
// pick them up from `create table if not exists`, so init() also applies these
// idempotent alters to bring an existing database up to date.
export const POSTGRES_MIGRATION_DDL = [
  `alter table ${TABLE} add column if not exists expires_at timestamptz`,
];

// Supabase deployments enable RLS as defense-in-depth: with no policies the
// anon key can read nothing. The real protection is app-level AES-256-GCM —
// secrets are ciphertext at rest. Harmless on a table the service role owns.
export const POSTGRES_RLS_DDL = `alter table ${TABLE} enable row level security`;

// Same columns as Postgres, but SQLite has no uuid or array type — ids are text
// and tags/metadata are JSON-encoded strings.
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
    expires_at text,
    secret_ciphertext text not null,
    secret_iv text not null,
    secret_tag text not null,
    key_id text not null default 'default',
    unique (namespace, name)
  )`;
