-- CryptoFort credential store (portable Postgres / Supabase).
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

-- Supabase / admin-gated deployments: enable RLS as defense-in-depth.
-- The real protection is app-level AES-256-GCM; secrets are ciphertext at rest.
alter table cryptofort_credentials enable row level security;
