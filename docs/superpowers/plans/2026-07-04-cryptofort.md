# CryptoFort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `cryptofort` — a TypeScript package that stores secrets encrypted-at-rest (AES-256-GCM, key from env) across pluggable DB backends (Supabase, SQLite, Postgres) and exposes an MCP server so agents can search and retrieve credentials.

**Architecture:** A `Vault` core class composes a `Crypto` module (seals/opens secrets) and a `CredentialStore` adapter (persists rows). Only the secret value is ciphertext; metadata stays plaintext so search works. An MCP server wraps the Vault and exposes read tools by default. Repo: `~/WebstormProjects/cryptofort` (public, branches `main`+`develop`).

**Tech Stack:** TypeScript, tsup (dual ESM+CJS), vitest, Web Crypto (`globalThis.crypto.subtle`), `@modelcontextprotocol/sdk`, optional peer deps `@supabase/supabase-js` / `postgres` / `better-sqlite3`.

**Conventions:** camelCase identifiers, PascalCase types/classes, 2-space indent, single quotes, no semicolon-free style (use semicolons). Comments explain WHY. All work commits to `develop`. Commit messages read as hand-written — NO AI attribution.

---

## File Structure

```
cryptofort/
  package.json
  tsconfig.json
  tsup.config.ts
  vitest.config.ts
  .eslintrc.cjs
  .prettierrc
  .gitignore
  .npmignore
  README.md
  src/
    index.ts            # public exports: Vault, Crypto, adapters, types
    types.ts            # SealedSecret, SealedRecord, CredentialMeta, CredentialInput, options
    crypto.ts           # Crypto class (AES-256-GCM)
    vault.ts            # Vault class
    adapters/
      types.ts          # CredentialStore interface
      sqlite.ts         # SqliteAdapter
      supabase.ts       # SupabaseAdapter
      postgres.ts       # PostgresAdapter
    mcp/
      server.ts         # buildServer(vault) -> McpServer wiring tools
      bin.ts            # #!/usr/bin/env node — reads env, starts stdio server
      config.ts         # adapterFromEnv() + cryptoFromEnv()
  test/
    crypto.test.ts
    sqlite.test.ts
    vault.test.ts
    supabase.test.ts
    postgres.test.ts
    mcp.test.ts
  sql/
    001_cryptofort_credentials.sql   # canonical schema (portable Postgres)
```

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `.npmignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "cryptofort",
  "version": "0.1.0",
  "description": "Encrypted-at-rest credential vault with pluggable DB backends and an MCP server for agents.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "cryptofort-mcp": "./dist/mcp/bin.js" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./mcp": {
      "types": "./dist/mcp/server.d.ts",
      "import": "./dist/mcp/server.js",
      "require": "./dist/mcp/server.cjs"
    }
  },
  "files": ["dist", "sql", "README.md"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --check ."
  },
  "engines": { "node": ">=20" },
  "peerDependencies": {
    "@modelcontextprotocol/sdk": ">=1.0.0",
    "@supabase/supabase-js": ">=2.0.0",
    "better-sqlite3": ">=11.0.0",
    "postgres": ">=3.4.0"
  },
  "peerDependenciesMeta": {
    "@modelcontextprotocol/sdk": { "optional": true },
    "@supabase/supabase-js": { "optional": true },
    "better-sqlite3": { "optional": true },
    "postgres": { "optional": true }
  },
  "devDependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@supabase/supabase-js": "^2.106.2",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.0.0",
    "better-sqlite3": "^11.0.0",
    "postgres": "^3.4.0",
    "tsup": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src"]
}
```

Note: `"lib": ["DOM"]` provides Web Crypto (`crypto.subtle`, `CryptoKey`) types without pulling a browser build.

- [ ] **Step 3: Create `tsup.config.ts`**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/mcp/server.ts', 'src/mcp/bin.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 5: Create `.eslintrc.cjs`**

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist', 'node_modules'],
};
```

Add `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` and `eslint` to devDependencies when running `npm install` in Step 8.

- [ ] **Step 6: Create `.prettierrc`**

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 7: Create `.gitignore` and `.npmignore`**

`.gitignore`:
```
node_modules
dist
*.log
.env
.DS_Store
```

`.npmignore`:
```
src
test
docs
tsconfig.json
tsup.config.ts
vitest.config.ts
.eslintrc.cjs
.prettierrc
```

- [ ] **Step 8: Install dependencies**

Run:
```bash
cd ~/WebstormProjects/cryptofort
npm install
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```
Expected: `node_modules` populated, no fatal errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold cryptofort package (ts, tsup, vitest)"
```

---

## Task 1: Shared types

**Files:**
- Create: `src/types.ts`
- Create: `src/adapters/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
/** The encrypted secret payload, all values base64. */
export interface SealedSecret {
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  keyId: string;
}

/** Non-secret, searchable fields returned by search/list. */
export interface CredentialMeta {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string[];
  provider: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
}

/** A full persisted row: metadata + sealed secret. */
export interface SealedRecord extends CredentialMeta, SealedSecret {}

/** Caller input for creating/updating a credential. */
export interface CredentialInput {
  name: string;
  secret: string;
  description?: string;
  tags?: string[];
  provider?: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  tags?: string[];
  namespace?: string;
  limit?: number;
}

export interface ListOptions {
  tags?: string[];
  namespace?: string;
}

export const DEFAULT_NAMESPACE = 'default';
```

- [ ] **Step 2: Create `src/adapters/types.ts`**

```ts
import type {
  CredentialMeta,
  ListOptions,
  SealedRecord,
  SearchOptions,
} from '../types.js';

/** Persistence contract. Implementations treat the sealed secret as opaque. */
export interface CredentialStore {
  /** Create the table/schema if it does not exist. Idempotent. */
  init(): Promise<void>;
  insert(row: SealedRecord): Promise<void>;
  update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void>;
  findByName(namespace: string, name: string): Promise<SealedRecord | null>;
  searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]>;
  listMeta(opts: ListOptions): Promise<CredentialMeta[]>;
  remove(namespace: string, name: string): Promise<void>;
  touchAccessed(namespace: string, name: string): Promise<void>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/adapters/types.ts
git commit -m "feat: add core types and CredentialStore interface"
```

---

## Task 2: Crypto module (AES-256-GCM)

**Files:**
- Create: `src/crypto.ts`
- Test: `test/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/crypto.test.ts
import { describe, it, expect } from 'vitest';
import { Crypto, generateKey } from '../src/crypto.js';

const key = generateKey(); // base64 32 bytes

describe('Crypto', () => {
  it('round-trips plaintext', async () => {
    const c = new Crypto({ key });
    const sealed = await c.seal('super-secret-token');
    expect(sealed.ciphertext).not.toContain('super-secret-token');
    const opened = await c.open(sealed);
    expect(opened).toBe('super-secret-token');
  });

  it('produces a distinct IV each call', async () => {
    const c = new Crypto({ key });
    const a = await c.seal('x');
    const b = await c.seal('x');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to open a tampered ciphertext', async () => {
    const c = new Crypto({ key });
    const sealed = await c.seal('x');
    const bad = { ...sealed, tag: Buffer.from('0'.repeat(16)).toString('base64') };
    await expect(c.open(bad)).rejects.toThrow();
  });

  it('fails to open with the wrong key', async () => {
    const sealed = await new Crypto({ key }).seal('x');
    const other = new Crypto({ key: generateKey() });
    await expect(other.open(sealed)).rejects.toThrow();
  });

  it('stamps the active keyId and opens older keys by id', async () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const oldSealed = await new Crypto({ key: oldKey, keyId: 'v1' }).seal('x');
    const c = new Crypto({ key: newKey, keyId: 'v2', keys: { v1: oldKey, v2: newKey } });
    expect((await c.seal('y')).keyId).toBe('v2');
    expect(await c.open(oldSealed)).toBe('x'); // opened via keys['v1']
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/crypto.test.ts`
Expected: FAIL — cannot find module `../src/crypto.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/crypto.ts
export interface Sealed {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (16 bytes)
  keyId: string;
}

export interface CryptoOptions {
  /** base64-encoded 32-byte active key */
  key: string;
  /** identifier stamped on newly sealed records; default 'default' */
  keyId?: string;
  /** optional map of keyId -> base64 key, for opening records sealed under old keys */
  keys?: Record<string, string>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Generate a fresh base64 32-byte key. */
export function generateKey(): string {
  const raw = new Uint8Array(32);
  globalThis.crypto.getRandomValues(raw);
  return Buffer.from(raw).toString('base64');
}

function decodeKey(b64: string): Uint8Array {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) {
    throw new Error(`cryptofort: master key must decode to 32 bytes, got ${raw.length}`);
  }
  return new Uint8Array(raw);
}

export class Crypto {
  private readonly activeKeyId: string;
  private readonly keys: Record<string, Uint8Array>;

  constructor(opts: CryptoOptions) {
    this.activeKeyId = opts.keyId ?? 'default';
    this.keys = {};
    const provided = opts.keys ?? { [this.activeKeyId]: opts.key };
    for (const [id, k] of Object.entries(provided)) this.keys[id] = decodeKey(k);
    // Ensure the active key is present even if `keys` was passed without it.
    if (!this.keys[this.activeKeyId]) this.keys[this.activeKeyId] = decodeKey(opts.key);
  }

  private async importKey(raw: Uint8Array): Promise<CryptoKey> {
    return globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  }

  async seal(plaintext: string): Promise<Sealed> {
    const iv = new Uint8Array(IV_BYTES);
    globalThis.crypto.getRandomValues(iv);
    const key = await this.importKey(this.keys[this.activeKeyId]);
    const out = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
        key,
        new TextEncoder().encode(plaintext),
      ),
    );
    // Web Crypto appends the GCM tag to the ciphertext; split for separate columns.
    const ct = out.slice(0, out.length - TAG_BYTES);
    const tag = out.slice(out.length - TAG_BYTES);
    return {
      ciphertext: Buffer.from(ct).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      tag: Buffer.from(tag).toString('base64'),
      keyId: this.activeKeyId,
    };
  }

  async open(sealed: Sealed): Promise<string> {
    const raw = this.keys[sealed.keyId];
    if (!raw) throw new Error(`cryptofort: no key available for keyId '${sealed.keyId}'`);
    const key = await this.importKey(raw);
    const ct = Buffer.from(sealed.ciphertext, 'base64');
    const tag = Buffer.from(sealed.tag, 'base64');
    const iv = new Uint8Array(Buffer.from(sealed.iv, 'base64'));
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: TAG_BYTES * 8 },
      key,
      combined,
    );
    return new TextDecoder().decode(plain);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/crypto.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/crypto.ts test/crypto.test.ts
git commit -m "feat: add AES-256-GCM Crypto with key-id rotation support"
```

---

## Task 3: SqliteAdapter

**Files:**
- Create: `src/adapters/sqlite.ts`
- Test: `test/sqlite.test.ts`

This adapter is the reference used to test the Vault, so build it early. It uses `better-sqlite3` with an in-memory DB in tests.

- [ ] **Step 1: Write the failing test**

```ts
// test/sqlite.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteAdapter } from '../src/adapters/sqlite.js';
import type { SealedRecord } from '../src/types.js';

function row(over: Partial<SealedRecord> = {}): SealedRecord {
  return {
    id: over.id ?? 'id-1',
    namespace: over.namespace ?? 'default',
    name: over.name ?? 'stripe-key',
    description: over.description ?? 'Stripe secret',
    tags: over.tags ?? ['payments', 'stripe'],
    provider: over.provider ?? 'stripe',
    metadata: over.metadata ?? { env: 'prod' },
    createdAt: over.createdAt ?? '2026-07-04T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-04T00:00:00.000Z',
    lastAccessedAt: over.lastAccessedAt ?? null,
    secretCiphertext: over.secretCiphertext ?? 'ct',
    secretIv: over.secretIv ?? 'iv',
    secretTag: over.secretTag ?? 'tag',
    keyId: over.keyId ?? 'default',
  };
}

describe('SqliteAdapter', () => {
  let a: SqliteAdapter;
  beforeEach(async () => {
    a = new SqliteAdapter(':memory:');
    await a.init();
  });

  it('inserts and finds by name', async () => {
    await a.insert(row());
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct');
    expect(found?.tags).toEqual(['payments', 'stripe']);
    expect(found?.metadata).toEqual({ env: 'prod' });
  });

  it('returns null for a missing name', async () => {
    expect(await a.findByName('default', 'nope')).toBeNull();
  });

  it('updates fields', async () => {
    await a.insert(row());
    await a.update('default', 'stripe-key', { secretCiphertext: 'ct2', description: 'new' });
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct2');
    expect(found?.description).toBe('new');
  });

  it('searchMeta matches name/description/provider/tags and omits secrets', async () => {
    await a.insert(row());
    await a.insert(row({ id: 'id-2', name: 'openai-key', provider: 'openai', tags: ['ai'], description: 'OpenAI' }));
    const hits = await a.searchMeta('stripe', {});
    expect(hits.map((h) => h.name)).toEqual(['stripe-key']);
    expect(hits[0]).not.toHaveProperty('secretCiphertext');
  });

  it('searchMeta filters by tag and namespace and respects limit', async () => {
    await a.insert(row({ id: 'x', tags: ['payments'] }));
    await a.insert(row({ id: 'y', name: 'other', namespace: 'proj', tags: ['payments'] }));
    const hits = await a.searchMeta('', { tags: ['payments'], namespace: 'proj' });
    expect(hits.map((h) => h.name)).toEqual(['other']);
    const limited = await a.searchMeta('', { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('listMeta returns all metadata for a namespace, no secrets', async () => {
    await a.insert(row());
    const list = await a.listMeta({});
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('secretTag');
  });

  it('remove deletes the row', async () => {
    await a.insert(row());
    await a.remove('default', 'stripe-key');
    expect(await a.findByName('default', 'stripe-key')).toBeNull();
  });

  it('touchAccessed sets lastAccessedAt', async () => {
    await a.insert(row());
    await a.touchAccessed('default', 'stripe-key');
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.lastAccessedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sqlite.test.ts`
Expected: FAIL — cannot find module `../src/adapters/sqlite.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/adapters/sqlite.ts
import Database from 'better-sqlite3';
import type { CredentialStore } from './types.js';
import {
  DEFAULT_NAMESPACE,
  type CredentialMeta,
  type ListOptions,
  type SealedRecord,
  type SearchOptions,
} from '../types.js';

interface Db {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
}

interface DbRow {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string;
  provider: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  key_id: string;
}

function toMeta(r: DbRow): CredentialMeta {
  return {
    id: r.id,
    namespace: r.namespace,
    name: r.name,
    description: r.description,
    tags: JSON.parse(r.tags) as string[],
    provider: r.provider,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at,
  };
}

function toRecord(r: DbRow): SealedRecord {
  return {
    ...toMeta(r),
    secretCiphertext: r.secret_ciphertext,
    secretIv: r.secret_iv,
    secretTag: r.secret_tag,
    keyId: r.key_id,
  };
}

export class SqliteAdapter implements CredentialStore {
  private readonly db: Db;

  constructor(path = 'cryptofort.db') {
    this.db = new Database(path) as unknown as Db;
  }

  async init(): Promise<void> {
    this.db.exec(`
      create table if not exists cryptofort_credentials (
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
      );
    `);
  }

  async insert(row: SealedRecord): Promise<void> {
    this.db
      .prepare(
        `insert into cryptofort_credentials
         (id, namespace, name, description, tags, provider, metadata,
          created_at, updated_at, last_accessed_at,
          secret_ciphertext, secret_iv, secret_tag, key_id)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.namespace,
        row.name,
        row.description,
        JSON.stringify(row.tags),
        row.provider,
        JSON.stringify(row.metadata),
        row.createdAt,
        row.updatedAt,
        row.lastAccessedAt,
        row.secretCiphertext,
        row.secretIv,
        row.secretTag,
        row.keyId,
      );
  }

  async update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void> {
    const map: Record<string, string> = {
      description: 'description',
      provider: 'provider',
      secretCiphertext: 'secret_ciphertext',
      secretIv: 'secret_iv',
      secretTag: 'secret_tag',
      keyId: 'key_id',
      updatedAt: 'updated_at',
      lastAccessedAt: 'last_accessed_at',
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        vals.push((patch as Record<string, unknown>)[k]);
      }
    }
    if ('tags' in patch) {
      sets.push('tags = ?');
      vals.push(JSON.stringify(patch.tags));
    }
    if ('metadata' in patch) {
      sets.push('metadata = ?');
      vals.push(JSON.stringify(patch.metadata));
    }
    if (sets.length === 0) return;
    vals.push(namespace, name);
    this.db
      .prepare(
        `update cryptofort_credentials set ${sets.join(', ')} where namespace = ? and name = ?`,
      )
      .run(...vals);
  }

  async findByName(namespace: string, name: string): Promise<SealedRecord | null> {
    const r = this.db
      .prepare(`select * from cryptofort_credentials where namespace = ? and name = ?`)
      .get(namespace, name) as DbRow | undefined;
    return r ? toRecord(r) : null;
  }

  async searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]> {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (opts.namespace) {
      where.push('namespace = ?');
      vals.push(opts.namespace);
    }
    if (query) {
      const like = `%${query.toLowerCase()}%`;
      where.push(
        '(lower(name) like ? or lower(coalesce(description,\'\')) like ? or lower(coalesce(provider,\'\')) like ? or lower(tags) like ?)',
      );
      vals.push(like, like, like, like);
    }
    for (const tag of opts.tags ?? []) {
      where.push('tags like ?');
      vals.push(`%"${tag}"%`);
    }
    let sql = 'select * from cryptofort_credentials';
    if (where.length) sql += ' where ' + where.join(' and ');
    sql += ' order by name asc';
    if (opts.limit) sql += ` limit ${Number(opts.limit)}`;
    const rows = this.db.prepare(sql).all(...vals) as DbRow[];
    return rows.map(toMeta);
  }

  async listMeta(opts: ListOptions): Promise<CredentialMeta[]> {
    return this.searchMeta('', { namespace: opts.namespace, tags: opts.tags });
  }

  async remove(namespace: string, name: string): Promise<void> {
    this.db
      .prepare(`delete from cryptofort_credentials where namespace = ? and name = ?`)
      .run(namespace, name);
  }

  async touchAccessed(namespace: string, name: string): Promise<void> {
    this.db
      .prepare(
        `update cryptofort_credentials set last_accessed_at = ? where namespace = ? and name = ?`,
      )
      .run(new Date().toISOString(), namespace, name);
  }
}

export const _defaultNamespace = DEFAULT_NAMESPACE;
```

Note: `_defaultNamespace` export exists only to keep the `DEFAULT_NAMESPACE` import used; if the linter objects, import it where genuinely needed instead and drop this line.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sqlite.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/sqlite.ts test/sqlite.test.ts
git commit -m "feat: add SqliteAdapter with metadata search"
```

---

## Task 4: Vault core

**Files:**
- Create: `src/vault.ts`
- Test: `test/vault.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/vault.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../src/vault.js';
import { Crypto, generateKey } from '../src/crypto.js';
import { SqliteAdapter } from '../src/adapters/sqlite.js';

async function makeVault() {
  const adapter = new SqliteAdapter(':memory:');
  await adapter.init();
  return new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
}

describe('Vault', () => {
  let vault: Vault;
  beforeEach(async () => {
    vault = await makeVault();
  });

  it('put then get returns the decrypted secret', async () => {
    await vault.put({ name: 'stripe-key', secret: 'sk_live_123', provider: 'stripe' });
    expect(await vault.get('stripe-key')).toBe('sk_live_123');
  });

  it('get returns null for a missing credential', async () => {
    expect(await vault.get('nope')).toBeNull();
  });

  it('put upserts an existing credential', async () => {
    await vault.put({ name: 'k', secret: 'v1' });
    await vault.put({ name: 'k', secret: 'v2', description: 'updated' });
    expect(await vault.get('k')).toBe('v2');
    const [meta] = await vault.search('k');
    expect(meta.description).toBe('updated');
  });

  it('search returns metadata but never the secret', async () => {
    await vault.put({ name: 'stripe-key', secret: 'sk_live_123', description: 'stripe' });
    const hits = await vault.search('stripe');
    expect(hits).toHaveLength(1);
    const serialized = JSON.stringify(hits);
    expect(serialized).not.toContain('sk_live_123');
    expect(serialized).not.toContain('secretCiphertext');
  });

  it('list returns metadata without secrets', async () => {
    await vault.put({ name: 'a', secret: 'secret-a' });
    const list = await vault.list();
    expect(JSON.stringify(list)).not.toContain('secret-a');
  });

  it('respects namespace isolation', async () => {
    await vault.put({ name: 'k', secret: 'prod', namespace: 'proj-a' });
    await vault.put({ name: 'k', secret: 'dev', namespace: 'proj-b' });
    expect(await vault.get('k', { namespace: 'proj-a' })).toBe('prod');
    expect(await vault.get('k', { namespace: 'proj-b' })).toBe('dev');
  });

  it('get updates last_accessed_at', async () => {
    await vault.put({ name: 'k', secret: 'v' });
    await vault.get('k');
    const [meta] = await vault.search('k');
    expect(meta.lastAccessedAt).not.toBeNull();
  });

  it('remove deletes the credential', async () => {
    await vault.put({ name: 'k', secret: 'v' });
    await vault.remove('k');
    expect(await vault.get('k')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/vault.test.ts`
Expected: FAIL — cannot find module `../src/vault.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/vault.ts
import { Crypto } from './crypto.js';
import type { CredentialStore } from './adapters/types.js';
import {
  DEFAULT_NAMESPACE,
  type CredentialInput,
  type CredentialMeta,
  type ListOptions,
  type SealedRecord,
  type SearchOptions,
} from './types.js';

export interface VaultOptions {
  adapter: CredentialStore;
  crypto: Crypto;
}

export class Vault {
  private readonly adapter: CredentialStore;
  private readonly crypto: Crypto;

  constructor(opts: VaultOptions) {
    this.adapter = opts.adapter;
    this.crypto = opts.crypto;
  }

  async put(input: CredentialInput): Promise<void> {
    const namespace = input.namespace ?? DEFAULT_NAMESPACE;
    const sealed = await this.crypto.seal(input.secret);
    const now = new Date().toISOString();
    const existing = await this.adapter.findByName(namespace, input.name);
    if (existing) {
      const patch: Partial<SealedRecord> = {
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        secretTag: sealed.tag,
        keyId: sealed.keyId,
        updatedAt: now,
      };
      if (input.description !== undefined) patch.description = input.description;
      if (input.tags !== undefined) patch.tags = input.tags;
      if (input.provider !== undefined) patch.provider = input.provider;
      if (input.metadata !== undefined) patch.metadata = input.metadata;
      await this.adapter.update(namespace, input.name, patch);
      return;
    }
    const record: SealedRecord = {
      id: globalThis.crypto.randomUUID(),
      namespace,
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
      provider: input.provider ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: null,
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      keyId: sealed.keyId,
    };
    await this.adapter.insert(record);
  }

  async get(name: string, opts: { namespace?: string } = {}): Promise<string | null> {
    const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
    const record = await this.adapter.findByName(namespace, name);
    if (!record) return null;
    const secret = await this.crypto.open({
      ciphertext: record.secretCiphertext,
      iv: record.secretIv,
      tag: record.secretTag,
      keyId: record.keyId,
    });
    await this.adapter.touchAccessed(namespace, name);
    return secret;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<CredentialMeta[]> {
    return this.adapter.searchMeta(query, opts);
  }

  async list(opts: ListOptions = {}): Promise<CredentialMeta[]> {
    return this.adapter.listMeta(opts);
  }

  async remove(name: string, opts: { namespace?: string } = {}): Promise<void> {
    await this.adapter.remove(opts.namespace ?? DEFAULT_NAMESPACE, name);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/vault.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/vault.ts test/vault.test.ts
git commit -m "feat: add Vault core (put/get/search/list/remove)"
```

---

## Task 5: SupabaseAdapter

**Files:**
- Create: `src/adapters/supabase.ts`
- Test: `test/supabase.test.ts`

The adapter depends on a `SupabaseClient`. The test injects a hand-rolled fake client that records calls and returns canned rows, so no network is needed.

- [ ] **Step 1: Write the failing test**

```ts
// test/supabase.test.ts
import { describe, it, expect } from 'vitest';
import { SupabaseAdapter } from '../src/adapters/supabase.js';
import type { SealedRecord } from '../src/types.js';

// Minimal fake of the PostgREST query builder used by the adapter.
function fakeClient(store: Record<string, any>[]) {
  const calls: any[] = [];
  const builder = () => {
    const state: any = { filters: [], _limit: undefined, _order: undefined };
    const b: any = {
      insert: (row: any) => {
        store.push(row);
        return Promise.resolve({ error: null });
      },
      update: (patch: any) => {
        state.patch = patch;
        return b;
      },
      delete: () => {
        state.delete = true;
        return b;
      },
      select: () => b,
      eq: (col: string, val: any) => {
        state.filters.push(['eq', col, val]);
        return b;
      },
      or: (expr: string) => {
        state.filters.push(['or', expr]);
        return b;
      },
      contains: (col: string, val: any) => {
        state.filters.push(['contains', col, val]);
        return b;
      },
      order: (col: string) => {
        state._order = col;
        return b;
      },
      limit: (n: number) => {
        state._limit = n;
        return b;
      },
      maybeSingle: () => {
        calls.push(state);
        const match = store.find((r) =>
          state.filters.every(([op, c, v]: any[]) => op !== 'eq' || r[c] === v),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
      then: (resolve: any) => {
        calls.push(state);
        if (state.delete || state.patch) {
          const idx = store.findIndex((r) =>
            state.filters.every(([op, c, v]: any[]) => op !== 'eq' || r[c] === v),
          );
          if (idx >= 0 && state.delete) store.splice(idx, 1);
          if (idx >= 0 && state.patch) Object.assign(store[idx], state.patch);
          return resolve({ error: null });
        }
        let rows = store.slice();
        for (const [op, c, v] of state.filters) {
          if (op === 'eq') rows = rows.filter((r) => r[c] === v);
        }
        if (state._limit) rows = rows.slice(0, state._limit);
        return resolve({ data: rows, error: null });
      },
    };
    return b;
  };
  return { from: () => builder(), _calls: calls };
}

function dbRow(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'id-1',
    namespace: over.namespace ?? 'default',
    name: over.name ?? 'stripe-key',
    description: over.description ?? 'Stripe',
    tags: over.tags ?? ['payments'],
    provider: over.provider ?? 'stripe',
    metadata: over.metadata ?? {},
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_accessed_at: null,
    secret_ciphertext: 'ct',
    secret_iv: 'iv',
    secret_tag: 'tag',
    key_id: 'default',
  };
}

describe('SupabaseAdapter', () => {
  it('findByName maps a snake_case row to a SealedRecord', async () => {
    const store = [dbRow()];
    const a = new SupabaseAdapter(fakeClient(store) as any);
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct');
    expect(found?.tags).toEqual(['payments']);
  });

  it('insert writes a snake_case row without leaking camelCase keys', async () => {
    const store: any[] = [];
    const a = new SupabaseAdapter(fakeClient(store) as any);
    const rec: SealedRecord = {
      id: 'id-9',
      namespace: 'default',
      name: 'k',
      description: null,
      tags: ['t'],
      provider: null,
      metadata: {},
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
      lastAccessedAt: null,
      secretCiphertext: 'c',
      secretIv: 'i',
      secretTag: 'g',
      keyId: 'default',
    };
    await a.insert(rec);
    expect(store[0].secret_ciphertext).toBe('c');
    expect(store[0]).not.toHaveProperty('secretCiphertext');
  });

  it('searchMeta returns metadata objects without secret fields', async () => {
    const store = [dbRow()];
    const a = new SupabaseAdapter(fakeClient(store) as any);
    const hits = await a.searchMeta('', { namespace: 'default' });
    expect(hits[0]).not.toHaveProperty('secretCiphertext');
    expect(hits[0].name).toBe('stripe-key');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/supabase.test.ts`
Expected: FAIL — cannot find module `../src/adapters/supabase.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/adapters/supabase.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CredentialStore } from './types.js';
import type {
  CredentialMeta,
  ListOptions,
  SealedRecord,
  SearchOptions,
} from '../types.js';

const TABLE = 'cryptofort_credentials';

interface DbRow {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string[];
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  key_id: string;
}

const META_COLUMNS =
  'id, namespace, name, description, tags, provider, metadata, created_at, updated_at, last_accessed_at';

function toMeta(r: DbRow): CredentialMeta {
  return {
    id: r.id,
    namespace: r.namespace,
    name: r.name,
    description: r.description,
    tags: r.tags ?? [],
    provider: r.provider,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at,
  };
}

function toRecord(r: DbRow): SealedRecord {
  return {
    ...toMeta(r),
    secretCiphertext: r.secret_ciphertext,
    secretIv: r.secret_iv,
    secretTag: r.secret_tag,
    keyId: r.key_id,
  };
}

function toDbInsert(row: SealedRecord): DbRow {
  return {
    id: row.id,
    namespace: row.namespace,
    name: row.name,
    description: row.description,
    tags: row.tags,
    provider: row.provider,
    metadata: row.metadata,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_accessed_at: row.lastAccessedAt,
    secret_ciphertext: row.secretCiphertext,
    secret_iv: row.secretIv,
    secret_tag: row.secretTag,
    key_id: row.keyId,
  };
}

function patchToDb(patch: Partial<SealedRecord>): Record<string, unknown> {
  const map: Record<string, string> = {
    description: 'description',
    tags: 'tags',
    provider: 'provider',
    metadata: 'metadata',
    updatedAt: 'updated_at',
    lastAccessedAt: 'last_accessed_at',
    secretCiphertext: 'secret_ciphertext',
    secretIv: 'secret_iv',
    secretTag: 'secret_tag',
    keyId: 'key_id',
  };
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) out[col] = (patch as Record<string, unknown>)[k];
  }
  return out;
}

export class SupabaseAdapter implements CredentialStore {
  constructor(private readonly client: SupabaseClient) {}

  // Schema is provisioned via migration; init is a no-op for Supabase.
  async init(): Promise<void> {}

  async insert(row: SealedRecord): Promise<void> {
    const { error } = await this.client.from(TABLE).insert(toDbInsert(row));
    if (error) throw new Error(`cryptofort: insert failed: ${error.message}`);
  }

  async update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update(patchToDb(patch))
      .eq('namespace', namespace)
      .eq('name', name);
    if (error) throw new Error(`cryptofort: update failed: ${error.message}`);
  }

  async findByName(namespace: string, name: string): Promise<SealedRecord | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('namespace', namespace)
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(`cryptofort: findByName failed: ${error.message}`);
    return data ? toRecord(data as DbRow) : null;
  }

  async searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]> {
    let q = this.client.from(TABLE).select(META_COLUMNS);
    if (opts.namespace) q = q.eq('namespace', opts.namespace);
    if (query) {
      const like = `%${query}%`;
      q = q.or(
        `name.ilike.${like},description.ilike.${like},provider.ilike.${like}`,
      );
    }
    if (opts.tags && opts.tags.length) q = q.contains('tags', opts.tags);
    q = q.order('name');
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`cryptofort: search failed: ${error.message}`);
    return (data as DbRow[]).map(toMeta);
  }

  async listMeta(opts: ListOptions): Promise<CredentialMeta[]> {
    return this.searchMeta('', { namespace: opts.namespace, tags: opts.tags });
  }

  async remove(namespace: string, name: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .delete()
      .eq('namespace', namespace)
      .eq('name', name);
    if (error) throw new Error(`cryptofort: remove failed: ${error.message}`);
  }

  async touchAccessed(namespace: string, name: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('namespace', namespace)
      .eq('name', name);
    if (error) throw new Error(`cryptofort: touch failed: ${error.message}`);
  }
}
```

Note on tag search: `contains('tags', [...])` uses Postgres array containment, so tag filtering runs server-side. The `query` term matches name/description/provider via `ilike`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/supabase.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/supabase.ts test/supabase.test.ts
git commit -m "feat: add SupabaseAdapter"
```

---

## Task 6: PostgresAdapter

**Files:**
- Create: `src/adapters/postgres.ts`
- Test: `test/postgres.test.ts`

The adapter takes a `postgres` (porsager) `Sql` tagged-template function. The test injects a fake `sql` that records the query fragments and returns canned rows, so no live DB is needed.

- [ ] **Step 1: Write the failing test**

```ts
// test/postgres.test.ts
import { describe, it, expect } from 'vitest';
import { PostgresAdapter } from '../src/adapters/postgres.js';
import type { SealedRecord } from '../src/types.js';

// Fake porsager `sql`: records calls, returns queued results.
function fakeSql() {
  const calls: { strings: string[]; args: unknown[] }[] = [];
  const results: any[][] = [];
  const sql: any = (strings: TemplateStringsArray, ...args: unknown[]) => {
    calls.push({ strings: Array.from(strings), args });
    // Nested sql`` fragments (used to build WHERE) are objects, not awaited directly.
    const promise: any = Promise.resolve(results.shift() ?? []);
    promise.strings = Array.from(strings);
    promise.args = args;
    return promise;
  };
  sql.unsafe = (s: string) => ({ unsafe: s });
  sql._calls = calls;
  sql._queue = (rows: any[]) => results.push(rows);
  return sql;
}

function dbRow(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'id-1',
    namespace: 'default',
    name: over.name ?? 'stripe-key',
    description: 'Stripe',
    tags: over.tags ?? ['payments'],
    provider: 'stripe',
    metadata: {},
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_accessed_at: null,
    secret_ciphertext: 'ct',
    secret_iv: 'iv',
    secret_tag: 'tag',
    key_id: 'default',
  };
}

describe('PostgresAdapter', () => {
  it('findByName maps a row to a SealedRecord', async () => {
    const sql = fakeSql();
    sql._queue([dbRow()]);
    const a = new PostgresAdapter(sql);
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct');
    expect(found?.tags).toEqual(['payments']);
  });

  it('findByName returns null when no row', async () => {
    const sql = fakeSql();
    sql._queue([]);
    const a = new PostgresAdapter(sql);
    expect(await a.findByName('default', 'x')).toBeNull();
  });

  it('searchMeta returns metadata without secret fields', async () => {
    const sql = fakeSql();
    sql._queue([dbRow()]);
    const a = new PostgresAdapter(sql);
    const hits = await a.searchMeta('stripe', {});
    expect(hits[0]).not.toHaveProperty('secretCiphertext');
    expect(hits[0].name).toBe('stripe-key');
  });

  it('insert passes a snake_case payload', async () => {
    const sql = fakeSql();
    const a = new PostgresAdapter(sql);
    const rec: SealedRecord = {
      id: 'id-9', namespace: 'default', name: 'k', description: null, tags: ['t'],
      provider: null, metadata: {}, createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z', lastAccessedAt: null,
      secretCiphertext: 'c', secretIv: 'i', secretTag: 'g', keyId: 'default',
    };
    await a.insert(rec);
    const payload = sql._calls.at(-1)?.args[0] as Record<string, unknown>;
    expect(payload.secret_ciphertext).toBe('c');
    expect(payload).not.toHaveProperty('secretCiphertext');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/postgres.test.ts`
Expected: FAIL — cannot find module `../src/adapters/postgres.js`.

- [ ] **Step 3: Write the implementation**

```ts
// src/adapters/postgres.ts
import type { CredentialStore } from './types.js';
import type {
  CredentialMeta,
  ListOptions,
  SealedRecord,
  SearchOptions,
} from '../types.js';

/** Structural subset of porsager `postgres` we depend on. */
export interface Sql {
  (strings: TemplateStringsArray, ...args: unknown[]): Promise<Record<string, unknown>[]> & {
    strings?: string[];
    args?: unknown[];
  };
  unsafe(query: string): unknown;
}

interface DbRow {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string[];
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  key_id: string;
}

function toMeta(r: DbRow): CredentialMeta {
  return {
    id: r.id,
    namespace: r.namespace,
    name: r.name,
    description: r.description,
    tags: r.tags ?? [],
    provider: r.provider,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at,
  };
}

function toRecord(r: DbRow): SealedRecord {
  return {
    ...toMeta(r),
    secretCiphertext: r.secret_ciphertext,
    secretIv: r.secret_iv,
    secretTag: r.secret_tag,
    keyId: r.key_id,
  };
}

export class PostgresAdapter implements CredentialStore {
  constructor(private readonly sql: Sql) {}

  async init(): Promise<void> {
    await this.sql`
      create table if not exists cryptofort_credentials (
        id uuid primary key,
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
  }

  async insert(row: SealedRecord): Promise<void> {
    await this.sql`insert into cryptofort_credentials ${this.sql /* row payload */`${{
      id: row.id,
      namespace: row.namespace,
      name: row.name,
      description: row.description,
      tags: row.tags,
      provider: row.provider,
      metadata: row.metadata,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      last_accessed_at: row.lastAccessedAt,
      secret_ciphertext: row.secretCiphertext,
      secret_iv: row.secretIv,
      secret_tag: row.secretTag,
      key_id: row.keyId,
    } as unknown}`}`;
  }

  async update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void> {
    const map: Record<string, string> = {
      description: 'description',
      tags: 'tags',
      provider: 'provider',
      metadata: 'metadata',
      updatedAt: 'updated_at',
      lastAccessedAt: 'last_accessed_at',
      secretCiphertext: 'secret_ciphertext',
      secretIv: 'secret_iv',
      secretTag: 'secret_tag',
      keyId: 'key_id',
    };
    const payload: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) payload[col] = (patch as Record<string, unknown>)[k];
    }
    if (Object.keys(payload).length === 0) return;
    await this.sql`update cryptofort_credentials set ${this.sql`${payload as unknown}`}
      where namespace = ${namespace} and name = ${name}`;
  }

  async findByName(namespace: string, name: string): Promise<SealedRecord | null> {
    const rows = (await this.sql`select * from cryptofort_credentials
      where namespace = ${namespace} and name = ${name} limit 1`) as unknown as DbRow[];
    return rows.length ? toRecord(rows[0]) : null;
  }

  async searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]> {
    const like = `%${query}%`;
    const rows = (await this.sql`
      select id, namespace, name, description, tags, provider, metadata,
             created_at, updated_at, last_accessed_at
      from cryptofort_credentials
      where (${!opts.namespace} or namespace = ${opts.namespace ?? ''})
        and (${!query} or name ilike ${like} or description ilike ${like} or provider ilike ${like})
        and (${!opts.tags || !opts.tags.length} or tags @> ${opts.tags ?? []})
      order by name asc
      limit ${opts.limit ?? 1000}`) as unknown as DbRow[];
    return rows.map(toMeta);
  }

  async listMeta(opts: ListOptions): Promise<CredentialMeta[]> {
    return this.searchMeta('', { namespace: opts.namespace, tags: opts.tags });
  }

  async remove(namespace: string, name: string): Promise<void> {
    await this.sql`delete from cryptofort_credentials
      where namespace = ${namespace} and name = ${name}`;
  }

  async touchAccessed(namespace: string, name: string): Promise<void> {
    await this.sql`update cryptofort_credentials set last_accessed_at = now()
      where namespace = ${namespace} and name = ${name}`;
  }
}
```

Note: the fake `sql` in the test resolves each tagged call to the queued rows and records `args`, so `insert`'s payload object is asserted from `_calls`. Against real porsager `postgres`, `sql\`... ${obj}\`` and `sql(obj)` helpers build the column list; if the real driver rejects the inline `${payload}` helper form, switch `insert`/`update` to `this.sql\`... ${this.sql(payload)}\`` — porsager exposes `sql(object)` for insert/update payloads. Verify against the driver during Task 6 and adjust the two write methods accordingly; the read methods and mapping are what the unit tests lock down.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/postgres.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/postgres.ts test/postgres.test.ts
git commit -m "feat: add PostgresAdapter"
```

---

## Task 7: Public exports

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```ts
export { Vault, type VaultOptions } from './vault.js';
export { Crypto, generateKey, type Sealed, type CryptoOptions } from './crypto.js';
export { SqliteAdapter } from './adapters/sqlite.js';
export { SupabaseAdapter } from './adapters/supabase.js';
export { PostgresAdapter, type Sql } from './adapters/postgres.js';
export type { CredentialStore } from './adapters/types.js';
export {
  DEFAULT_NAMESPACE,
  type SealedSecret,
  type SealedRecord,
  type CredentialMeta,
  type CredentialInput,
  type SearchOptions,
  type ListOptions,
} from './types.js';
```

- [ ] **Step 2: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add public package exports"
```

---

## Task 8: MCP server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/config.ts`
- Create: `src/mcp/bin.ts`
- Test: `test/mcp.test.ts`

The tool handlers are extracted into a `buildTools(vault, allowWrite)` map so they can be unit-tested without a live MCP transport.

- [ ] **Step 1: Write the failing test**

```ts
// test/mcp.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '../src/mcp/server.js';
import { Vault } from '../src/vault.js';
import { Crypto, generateKey } from '../src/crypto.js';
import { SqliteAdapter } from '../src/adapters/sqlite.js';

async function makeVault() {
  const adapter = new SqliteAdapter(':memory:');
  await adapter.init();
  return new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
}

describe('mcp buildTools', () => {
  let vault: Vault;
  beforeEach(async () => {
    vault = await makeVault();
    await vault.put({ name: 'stripe-key', secret: 'sk_live_1', provider: 'stripe', tags: ['pay'] });
  });

  it('exposes read tools only by default', () => {
    const tools = buildTools(vault, false);
    expect(Object.keys(tools).sort()).toEqual([
      'credential_get',
      'credential_list',
      'credential_search',
    ]);
  });

  it('adds credential_put when write is allowed', () => {
    const tools = buildTools(vault, true);
    expect(Object.keys(tools)).toContain('credential_put');
  });

  it('credential_search returns metadata without secrets', async () => {
    const tools = buildTools(vault, false);
    const res = await tools.credential_search.handler({ query: 'stripe' });
    const text = res.content[0].text;
    expect(text).toContain('stripe-key');
    expect(text).not.toContain('sk_live_1');
  });

  it('credential_get returns the decrypted secret', async () => {
    const tools = buildTools(vault, false);
    const res = await tools.credential_get.handler({ name: 'stripe-key' });
    expect(res.content[0].text).toBe('sk_live_1');
  });

  it('credential_get reports when a credential is missing', async () => {
    const tools = buildTools(vault, false);
    const res = await tools.credential_get.handler({ name: 'nope' });
    expect(res.content[0].text.toLowerCase()).toContain('not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL — cannot find module `../src/mcp/server.js`.

- [ ] **Step 3: Write `src/mcp/server.ts`**

```ts
// src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Vault } from '../vault.js';

interface ToolResult {
  content: { type: 'text'; text: string }[];
}

interface ToolDef {
  description: string;
  schema: z.ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const text = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] });

export function buildTools(vault: Vault, allowWrite: boolean): Record<string, ToolDef> {
  const tools: Record<string, ToolDef> = {
    credential_search: {
      description:
        'Search stored credentials by name, description, provider, or tag. Returns metadata only — never the secret value.',
      schema: {
        query: z.string().describe('Free-text search term'),
        tags: z.array(z.string()).optional(),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        const hits = await vault.search(a.query as string, {
          tags: a.tags as string[] | undefined,
          namespace: a.namespace as string | undefined,
        });
        return text(JSON.stringify(hits, null, 2));
      },
    },
    credential_get: {
      description:
        'Retrieve and decrypt a single credential secret by exact name. Do not print the value into logs or shared output unless the user asked for it.',
      schema: {
        name: z.string().describe('Exact credential name'),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        const secret = await vault.get(a.name as string, {
          namespace: a.namespace as string | undefined,
        });
        return text(secret ?? `not found: ${a.name as string}`);
      },
    },
    credential_list: {
      description: 'List credential metadata (no secrets) in a namespace, optionally filtered by tag.',
      schema: {
        namespace: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      handler: async (a) => {
        const list = await vault.list({
          namespace: a.namespace as string | undefined,
          tags: a.tags as string[] | undefined,
        });
        return text(JSON.stringify(list, null, 2));
      },
    },
  };

  if (allowWrite) {
    tools.credential_put = {
      description: 'Create or update a credential. Requires the server to run with --allow-write.',
      schema: {
        name: z.string(),
        secret: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        provider: z.string().optional(),
        namespace: z.string().optional(),
      },
      handler: async (a) => {
        await vault.put({
          name: a.name as string,
          secret: a.secret as string,
          description: a.description as string | undefined,
          tags: a.tags as string[] | undefined,
          provider: a.provider as string | undefined,
          namespace: a.namespace as string | undefined,
        });
        return text(`stored: ${a.name as string}`);
      },
    };
  }

  return tools;
}

export function buildServer(vault: Vault, allowWrite: boolean): McpServer {
  const server = new McpServer({ name: 'cryptofort', version: '0.1.0' });
  const tools = buildTools(vault, allowWrite);
  for (const [name, def] of Object.entries(tools)) {
    server.tool(name, def.description, def.schema, async (args: Record<string, unknown>) =>
      def.handler(args),
    );
  }
  return server;
}
```

Add `zod` to devDependencies and (as a peer) — it ships with the MCP SDK, but import it directly. Run `npm install zod` in this task if not already present.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write `src/mcp/config.ts`**

```ts
// src/mcp/config.ts
import { Crypto } from '../crypto.js';
import { SqliteAdapter } from '../adapters/sqlite.js';
import { SupabaseAdapter } from '../adapters/supabase.js';
import { PostgresAdapter } from '../adapters/postgres.js';
import type { CredentialStore } from '../adapters/types.js';

export function cryptoFromEnv(): Crypto {
  const key = process.env.CRYPTOFORT_MASTER_KEY;
  if (!key) throw new Error('cryptofort: CRYPTOFORT_MASTER_KEY is required');
  const keyId = process.env.CRYPTOFORT_KEY_ID ?? 'default';
  return new Crypto({ key, keyId });
}

export async function adapterFromEnv(): Promise<CredentialStore> {
  const kind = (process.env.CRYPTOFORT_ADAPTER ?? 'supabase').toLowerCase();
  if (kind === 'sqlite') {
    const adapter = new SqliteAdapter(process.env.CRYPTOFORT_SQLITE_PATH ?? 'cryptofort.db');
    await adapter.init();
    return adapter;
  }
  if (kind === 'postgres') {
    const { default: postgres } = await import('postgres');
    const url = process.env.CRYPTOFORT_POSTGRES_URL;
    if (!url) throw new Error('cryptofort: CRYPTOFORT_POSTGRES_URL is required');
    const adapter = new PostgresAdapter(postgres(url) as never);
    await adapter.init();
    return adapter;
  }
  if (kind === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error('cryptofort: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    return new SupabaseAdapter(createClient(url, serviceKey));
  }
  throw new Error(`cryptofort: unknown CRYPTOFORT_ADAPTER '${kind}'`);
}
```

- [ ] **Step 6: Write `src/mcp/bin.ts`**

```ts
#!/usr/bin/env node
// src/mcp/bin.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Vault } from '../vault.js';
import { buildServer } from './server.js';
import { adapterFromEnv, cryptoFromEnv } from './config.js';

async function main(): Promise<void> {
  const allowWrite = process.argv.includes('--allow-write');
  const vault = new Vault({ adapter: await adapterFromEnv(), crypto: cryptoFromEnv() });
  const server = buildServer(vault, allowWrite);
  await server.connect(new StdioServerTransport());
  // stderr is safe for diagnostics; stdout is the MCP channel.
  console.error(`cryptofort-mcp ready (write ${allowWrite ? 'enabled' : 'disabled'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 7: Typecheck + full test run + build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: PASS — all suites green, `dist/` produced with `index`, `mcp/server`, `mcp/bin`.

- [ ] **Step 8: Smoke-test the built server with SQLite**

Run:
```bash
CRYPTOFORT_ADAPTER=sqlite CRYPTOFORT_SQLITE_PATH=/tmp/cf-smoke.db \
CRYPTOFORT_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
node dist/mcp/bin.js --allow-write &
sleep 1; kill %1
```
Expected: prints `cryptofort-mcp ready (write enabled)` on stderr, no crash.

- [ ] **Step 9: Commit**

```bash
git add src/mcp test/mcp.test.ts package.json package-lock.json
git commit -m "feat: add MCP server, env config, and bin entrypoint"
```

---

## Task 9: SQL schema file + README

**Files:**
- Create: `sql/001_cryptofort_credentials.sql`
- Create: `README.md`

- [ ] **Step 1: Create `sql/001_cryptofort_credentials.sql`**

```sql
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
```

- [ ] **Step 2: Create `README.md`**

````markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add sql/001_cryptofort_credentials.sql README.md
git commit -m "docs: add SQL schema and README"
```

---

## Task 10: Provision the live Sunday Supabase table

**Files:** none in repo (uses the recorded SQL from Task 9). This runs against the shared TaylorURL project via the Management API — NOT `db push` (per the `supabase` context card).

- [ ] **Step 1: Load the Supabase Management token**

Run:
```bash
SBP=$(security find-generic-password -s "Supabase CLI" -a "access-token" -w | sed 's/^go-keyring-base64://' | base64 -D)
echo "${SBP:0:4}…"
```
Expected: prints `sbp_…` prefix.

- [ ] **Step 2: Apply the schema to project `gujgtjqqurildqurpffh`**

Run (send the contents of `sql/001_cryptofort_credentials.sql` as the query):
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/gujgtjqqurildqurpffh/database/query" \
  -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  --data @- <<'JSON'
{"query":"create table if not exists cryptofort_credentials (id uuid primary key default gen_random_uuid(), namespace text not null default 'default', name text not null, description text, tags text[] not null default '{}', provider text, metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_accessed_at timestamptz, secret_ciphertext text not null, secret_iv text not null, secret_tag text not null, key_id text not null default 'default', unique (namespace, name)); create index if not exists cryptofort_credentials_namespace_idx on cryptofort_credentials (namespace); create index if not exists cryptofort_credentials_tags_idx on cryptofort_credentials using gin (tags); alter table cryptofort_credentials enable row level security;"}
JSON
```
Expected: JSON response with no `error` field (empty array result).

- [ ] **Step 3: Add the admin-gated RLS select policy**

Run (substitute the admin user id from `SUNDAY_ADMIN_USER_ID`; the same UUID used elsewhere in the project):
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/gujgtjqqurildqurpffh/database/query" \
  -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  --data '{"query":"create policy cryptofort_admin_read on cryptofort_credentials for select using (auth.uid() = '\''<SUNDAY_ADMIN_USER_ID>'\''::uuid);"}'
```
Expected: no `error`. Note: with encryption at rest, even an anon read returns only ciphertext; this policy is defense-in-depth. Writes go through the service role (server-side), which bypasses RLS.

- [ ] **Step 4: Verify the table exists**

Run:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/gujgtjqqurildqurpffh/database/query" \
  -H "Authorization: Bearer $SBP" -H "Content-Type: application/json" \
  --data '{"query":"select count(*) from cryptofort_credentials;"}'
```
Expected: `[{"count":0}]`.

- [ ] **Step 5: Record the migration file in the repo**

Copy `sql/001_cryptofort_credentials.sql` content into a dated migration for the record of intent, then commit:
```bash
mkdir -p supabase/migrations
cp sql/001_cryptofort_credentials.sql "supabase/migrations/20260704000000_cryptofort_credentials.sql"
git add supabase/migrations/20260704000000_cryptofort_credentials.sql
git commit -m "chore: record cryptofort_credentials migration"
```

---

## Task 11: Wire CryptoFort into Sunday + add the Context Library card

This task spans two repos. The CryptoFort package must be published (or linked) before sunday-host can install it; for the initial wiring, publish to npm.

- [ ] **Step 1: Publish `cryptofort` to npm**

Run:
```bash
cd ~/WebstormProjects/cryptofort
npm run build && npm test
npm publish --access public
```
Expected: publish succeeds as `cryptofort@0.1.0`. If the name is taken, set `"name": "@taylorurl/cryptofort"` in `package.json`, update README/import examples, commit, and republish.

- [ ] **Step 2: Generate and record the host master key**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Store the output as `CRYPTOFORT_MASTER_KEY` in the sunday-host environment (where the Interface agent runs) and in the local Claude Code MCP env. Never place it behind a `VITE_` prefix or in browser-visible config (per the `security` card).

- [ ] **Step 3: Register the MCP server for agents**

Add to the agent/host Claude MCP config (and local `~/.claude` MCP settings) — read-only:
```json
{
  "mcpServers": {
    "cryptofort": {
      "command": "npx",
      "args": ["-y", "cryptofort-mcp"],
      "env": {
        "CRYPTOFORT_ADAPTER": "supabase",
        "SUPABASE_URL": "https://gujgtjqqurildqurpffh.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<service-role-key>",
        "CRYPTOFORT_MASTER_KEY": "<base64-32-bytes>"
      }
    }
  }
}
```

- [ ] **Step 4: Add the `cryptofort` Context Library card**

The Context Library lives in Supabase (source of truth), edited via sunday-my's Context tab / the `context-write` edge function. Add a card:

- **Topic (key):** `cryptofort`
- **Category:** Infrastructure
- **Tags:** `credentials, secrets, mcp, vault`
- **Body:**

```markdown
# cryptofort

CryptoFort is the encrypted credential vault. Secrets live in
`cryptofort_credentials` (Supabase project gujgtjqqurildqurpffh), sealed with
AES-256-GCM; the key is server-side env only.

## Finding a credential
- Agents access it through the `cryptofort` MCP server, not direct SQL.
- To locate a secret: call `credential_search({ query })` (e.g. "stripe",
  "openai"). Returns metadata only — name, provider, tags — never the value.
- To retrieve the value: call `credential_get({ name })` with the exact name
  from search.
- To browse: `credential_list({ namespace?, tags? })`.

## Rules
- Never print a retrieved secret into chat, logs, commits, or reports unless
  Trenton explicitly asks to see it.
- The server is read-only by default; there is no write tool unless it was
  started with --allow-write.
- Namespaces segment credentials per project; default namespace is `default`.
```

Apply via the `context-write` edge function (or the Context tab UI). Verify it appears in the library listing.

- [ ] **Step 5: Add `cryptofort` as a sunday-my dependency**

In `~/WebstormProjects/sunday-my`, add the package so the repo declares the dependency (used by host/agent tooling, never imported into the browser bundle):
```bash
cd ~/WebstormProjects/sunday-my
npm install cryptofort --save
```
Confirm `cryptofort` appears under `dependencies` in `package.json` and the build still passes: `npm run build`.

- [ ] **Step 6: Verify end-to-end**

Seed one credential and read it back through the MCP path:
```bash
CRYPTOFORT_ADAPTER=supabase \
SUPABASE_URL=https://gujgtjqqurildqurpffh.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> CRYPTOFORT_MASTER_KEY=<key> \
node -e "import('cryptofort').then(async ({Vault,Crypto,SupabaseAdapter})=>{const {createClient}=await import('@supabase/supabase-js');const v=new Vault({adapter:new SupabaseAdapter(createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)),crypto:new Crypto({key:process.env.CRYPTOFORT_MASTER_KEY})});await v.put({name:'cryptofort-selftest',secret:'it-works',provider:'test'});console.log('get:',await v.get('cryptofort-selftest'));await v.remove('cryptofort-selftest');})"
```
Expected: prints `get: it-works`. Confirms encryption round-trip against the live table.

---

## Self-Review Notes

- **Spec coverage:** Vault API (Task 4), AES-256-GCM + key rotation via key_id (Task 2), three adapters (Tasks 3/5/6), MCP read-only-by-default + credential_put behind --allow-write (Task 8), data model incl. namespace/metadata/last_accessed (Tasks 1/3/9), Supabase RLS admin-gated + Management-API provisioning not db push (Task 10), Context Library card + no browser import + npm publish (Task 11), dual ESM/CJS build + tests (Tasks 0/7/8). All spec sections map to a task.
- **Leak guard:** explicit tests that `search`/`list` never contain secret values or sealed fields (Tasks 4, 8).
- **Type consistency:** `SealedRecord`/`CredentialMeta`/`Sealed` field names are defined in Task 1/2 and reused verbatim across adapters, Vault, and MCP.
- **Known adjustment point:** porsager `postgres` write-payload helper form (Task 6, Step 3 note) — verify against the driver and switch to `sql(payload)` if needed; read paths are unit-locked.
```
