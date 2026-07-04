# CryptoFort — Design Spec

Date: 2026-07-04
Status: Approved (design), pending implementation plan

## Summary

CryptoFort is a standalone, project-agnostic TypeScript package for storing
secrets (API keys, tokens, credentials) **encrypted at rest** and letting agents
look them up. It ships:

1. A **core library** (`cryptofort`) with a single `Vault` API.
2. Pluggable **database adapters** (Supabase, SQLite, generic Postgres).
3. An **MCP server** (`cryptofort-mcp`) that Claude Code agents call as tools.

Secrets are sealed with AES-256-GCM using a master key held only in the
environment — never in the database. A full DB dump is useless without the key.

Sunday is the default deployment target but nothing in the package is
Sunday-specific. It is published to public npm and consumed like any dependency.

## Goals

- Agents can ask "find the stripe key" and get the decrypted secret via MCP.
- Secrets are unreadable to anyone with DB access alone (provider, DB admin, a
  leaked dump) — zero-trust of the storage layer.
- One package, several database backends, swappable via an adapter.
- Reusable across projects; Sunday's Supabase is just the default config.
- Runs in both Node (agent host, CLI) and Deno (edge functions) for the
  cross-runtime path (core + Supabase adapter).

## Non-Goals (v1)

- MySQL adapter (interface leaves room; not implemented in v1).
- Key-rotation tooling/CLI (schema carries `key_id` so it is possible later).
- A web UI for managing credentials.
- Multi-user tenancy beyond a `namespace` string column.
- Browser usage. The browser must never hold the master key or a service-role
  key, so CryptoFort is never bundled into a frontend.

## Architecture

```
                 ┌───────────────────────────┐
   Claude Code   │   cryptofort-mcp (stdio)   │   tools:
   agent  ─────► │   read-only by default     │   credential_search
                 └────────────┬──────────────┘    credential_get
                              │                    credential_list
                              ▼                   (credential_put w/ --allow-write)
                 ┌───────────────────────────┐
                 │        Vault (core)        │
                 │  search/get/list/put/remove│
                 └───────┬───────────┬────────┘
                         │           │
             ┌───────────▼──┐   ┌────▼─────────────┐
             │  crypto/     │   │  adapters/       │
             │ AES-256-GCM  │   │  Supabase        │
             │ Web Crypto   │   │  SQLite          │
             │ key from env │   │  Postgres        │
             └──────────────┘   └────┬─────────────┘
                                     ▼
                          cryptofort_credentials
                     (plaintext metadata + sealed secret)
```

### 1. Core library — `Vault`

The single public entry point. Constructed from an adapter + a crypto module.

```ts
const vault = new Vault({ adapter, crypto });

await vault.put({ name, secret, description?, tags?, provider?, namespace?, metadata? });
await vault.search(query, { tags?, namespace?, limit? }); // metadata only, NEVER the secret
await vault.get(name, { namespace? });                    // decrypted secret (only reveal path)
await vault.list({ namespace?, tags? });                  // metadata only
await vault.remove(name, { namespace? });
```

- `search` / `list` return `CredentialMeta` (id, name, description, tags,
  provider, namespace, timestamps) and **never** include the secret value.
- `get` is the only method that decrypts and returns a secret. It bumps
  `last_accessed_at`.
- `namespace` defaults to `"default"`; it segments credentials per project so
  one vault can serve many consumers.

### 2. Crypto — `crypto/`

- Algorithm: **AES-256-GCM** via Web Crypto (`crypto.subtle`) — no native
  dependency, works in Node and Deno.
- Master key: env `CRYPTOFORT_MASTER_KEY`, base64-encoded 32 bytes. Loaded once,
  never persisted, never returned by any API or tool.
- Per-record random 12-byte IV; GCM auth tag stored alongside ciphertext.
- Each row stamps `key_id` (default `"default"`). Future rotation can add
  `CRYPTOFORT_MASTER_KEYS` (a `key_id → key` map) and re-seal; out of scope now.
- Sealed shape stored: `{ secret_ciphertext, secret_iv, secret_tag, key_id }`
  (all base64 text columns).

### 3. Adapters — `adapters/`

One interface, three implementations. Only metadata is queried; the secret is an
opaque sealed blob to the adapter.

```ts
interface CredentialStore {
  insert(row: SealedRecord): Promise<void>;
  update(namespace: string, name: string, row: Partial<SealedRecord>): Promise<void>;
  findByName(namespace: string, name: string): Promise<SealedRecord | null>;
  searchMeta(namespace: string | undefined, query: string, opts): Promise<CredentialMeta[]>;
  listMeta(namespace: string | undefined, opts): Promise<CredentialMeta[]>;
  remove(namespace: string, name: string): Promise<void>;
  touchAccessed(namespace: string, name: string): Promise<void>;
}
```

- `SupabaseAdapter` — default; `@supabase/supabase-js` with the service-role key,
  server-side only. Cross-runtime (Node + Deno).
- `SqliteAdapter` — local single-file store via `better-sqlite3`. Node-only;
  acceptable. Good for offline / other projects with no provider.
- `PostgresAdapter` — any Postgres connection string via `postgres`
  (porsager). Self-hosted or other providers.

Adapter driver packages are **optional peerDependencies** — a consumer installs
only the driver for the backend they use.

### 4. MCP server — `cryptofort/mcp` (bin `cryptofort-mcp`)

- stdio MCP server built on `@modelcontextprotocol/sdk`.
- Config entirely from env: `CRYPTOFORT_ADAPTER` (`supabase|sqlite|postgres`),
  the adapter's connection env, and `CRYPTOFORT_MASTER_KEY`.
- Tools:
  - `credential_search({ query, tags?, namespace? })` → metadata list, no secrets.
  - `credential_get({ name, namespace? })` → the decrypted secret.
  - `credential_list({ namespace?, tags? })` → metadata list.
  - `credential_put({ ... })` → present **only** when launched with
    `--allow-write`. Read-only by default so a browsing agent cannot mutate.
- Never logs secret values.

## Data Model

Table `cryptofort_credentials`:

| column             | type        | notes                                   |
|--------------------|-------------|-----------------------------------------|
| id                 | uuid pk     | default gen_random_uuid()               |
| namespace          | text        | default `'default'`                     |
| name               | text        | logical key (e.g. `stripe-secret-key`)  |
| description        | text        | plaintext, searchable                   |
| tags               | text[]      | plaintext, searchable                   |
| provider           | text        | e.g. `stripe`, `openai`; searchable     |
| secret_ciphertext  | text        | base64 AES-256-GCM ciphertext           |
| secret_iv          | text        | base64 12-byte IV                       |
| secret_tag         | text        | base64 GCM auth tag                     |
| key_id             | text        | default `'default'`; for rotation       |
| metadata           | jsonb       | non-secret extra fields                 |
| created_at         | timestamptz | default now()                           |
| updated_at         | timestamptz | default now()                           |
| last_accessed_at   | timestamptz | null until first `get`                  |

- Unique constraint on `(namespace, name)`.
- Index on `namespace`; text search on `name/description/provider/tags` for
  `search`.
- On the Sunday Supabase project (`gujgtjqqurildqurpffh`): **RLS enabled**,
  admin-gated select policy (`auth.uid() = SUNDAY_ADMIN_USER_ID`). This is
  defense-in-depth; the real protection is the app-level encryption.

## Sunday Integration

- **No frontend import.** The Vite browser bundle never imports CryptoFort.
- "sunday-my imports it" means: add `cryptofort` as a dependency and register
  the `cryptofort-mcp` server in the agent/host Claude config that powers the
  Interface, plus local Claude Code. The host sets `CRYPTOFORT_ADAPTER=supabase`,
  the Supabase URL + service-role key, and `CRYPTOFORT_MASTER_KEY`.
- **Context Library card** `cryptofort` (Infrastructure category), added to the
  Sunday Context Library (Supabase-backed, per `_core`): tells every agent to
  use `credential_search` then `credential_get`, and to never print secrets into
  chat or logs unless explicitly asked.
- **Provision live:** create `cryptofort_credentials` in the Sunday Supabase
  project via the Management API (per the `supabase` card — Management API query
  endpoint, not `db push`), with a recorded migration file in the CryptoFort repo.

## Packaging & Distribution

- Repo: `~/WebstormProjects/cryptofort` (own git repo, `main`).
- TypeScript, built with `tsup` to dual ESM + CJS with type declarations.
- Subpath exports: `cryptofort` (core), `cryptofort/mcp` (server), plus adapter
  entry points if needed. `bin`: `cryptofort-mcp`.
- Published to **public npm** as `cryptofort` (fallback scope
  `@taylorurl/cryptofort` if the name is taken). Package contains code only, no
  secrets.
- Optional peerDependencies: `@supabase/supabase-js`, `postgres`,
  `better-sqlite3`, `@modelcontextprotocol/sdk`.

## Security Posture

- Master key only from env; never stored, logged, or returned.
- `search`/`list` provably never return secret values (covered by tests).
- Supabase adapter uses the service-role key server-side only; table RLS is
  admin-gated as a second layer.
- MCP server read-only unless `--allow-write` is passed.
- DB compromise ≠ secret compromise: ciphertext is meaningless without the env
  key.

## Testing (TDD)

- Crypto round-trip: seal → open recovers plaintext; wrong key / tampered tag
  fails; distinct IVs per call.
- Adapter CRUD against in-memory SQLite: insert/find/update/remove/touch.
- Search: matches on name/description/provider/tags; respects namespace + tags
  filters + limit.
- Leak guard: `search` and `list` results never contain any secret field.
- Runner: `vitest`.

## Build / Verify

- `npm run build` (tsup), `npm test` (vitest), `tsc --noEmit` typecheck,
  eslint/prettier clean.
