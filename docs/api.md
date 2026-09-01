# Library API

Everything a consumer can import is exported from the package root:

```ts
import {
  Vault,
  Crypto,
  generateKey,
  SqliteAdapter,
  PostgresAdapter,
  SupabaseAdapter,
  DEFAULT_NAMESPACE,
} from 'cryptofort';
```

Types are exported alongside them: `VaultOptions`, `CryptoOptions`, `Sealed`,
`Sql`, `CredentialStore`, `SealedSecret`, `SealedRecord`, `CredentialMeta`,
`CredentialInput`, `SearchOptions`, and `ListOptions`.

Anything not exported from the package root is internal and may change without
a version bump.

The package is ESM-first with a CommonJS build, so both work:

```ts
import { Vault } from 'cryptofort'; // ESM
const { Vault } = require('cryptofort'); // CJS
```

---

## `Vault`

The operations you actually call. A vault is an adapter plus a crypto — it does
the sealing and the expiry logic and leaves persistence to the adapter.

```ts
new Vault({ adapter, crypto });
```

```ts
interface VaultOptions {
  adapter: CredentialStore;
  crypto: Crypto;
}
```

The adapter must have had `init()` called on it before the vault is used.

### `put(input: CredentialInput): Promise<void>`

Create a credential, or update the one that already holds that
`(namespace, name)`.

```ts
await vault.put({
  name: 'stripe-secret-key',
  secret: 'sk_live_…',
  description: 'Live payments key',
  provider: 'stripe',
  tags: ['payments', 'production'],
  namespace: 'production',
  metadata: { owner: 'checkout-team' },
  expiresAt: '2026-12-31T00:00:00Z',
});
```

```ts
interface CredentialInput {
  name: string;
  secret: string;
  description?: string;
  tags?: string[];
  provider?: string;
  namespace?: string; // default: 'default'
  metadata?: Record<string, unknown>;
  expiresAt?: string | null; // ISO 8601; null clears an existing expiry
}
```

Only `secret` is encrypted. Everything else is stored in plaintext so search and
listing work without decrypting — do not put a secret in any of them.

On update, the secret is always re-sealed, and **only the optional fields you
pass are patched**. Omitting `tags` leaves the existing tags alone; passing
`tags: []` clears them. The same holds for `description`, `provider`,
`metadata`, and `expiresAt` — pass `expiresAt: null` to remove an expiry, and
omit it to leave one in place.

One exception: if the existing record has **already expired**, it is deleted and
replaced wholesale rather than patched, so a stale expiry, description, or tag
set cannot ride along and kill the new secret.

`expiresAt` accepts any string `Date.parse` understands and is normalised to
canonical UTC ISO 8601 before storage. An unparseable value throws
`cryptofort: invalid expiresAt timestamp: <value>`.

### `get(name, opts?): Promise<string | null>`

Decrypt and return one secret by exact name.

```ts
const secret = await vault.get('stripe-secret-key');
const staging = await vault.get('db-url', { namespace: 'staging' });
```

Returns `null` when there is no such credential — it does not throw. It also
returns `null` when the credential has expired, and **deletes the record as it
does so**, rather than handing out a secret a purge sweep merely has not reached
yet.

A successful read updates `lastAccessedAt`. That is a timestamp, not an audit
trail: it records that the credential was read, not by whom.

Throws if the record cannot be opened — a wrong key, a missing `keyId`, or a
tampered ciphertext.

### `search(query, opts?): Promise<CredentialMeta[]>`

Free-text search over **metadata only**. The secret is never in the result.

```ts
await vault.search('stripe');
await vault.search('', { tags: ['production'], namespace: 'prod', limit: 50 });
```

```ts
interface SearchOptions {
  tags?: string[]; // records must carry all of these
  namespace?: string; // unset searches every namespace
  limit?: number;
}
```

The query matches `name`, `description`, and `provider`, case-insensitively, as
a substring. An empty query matches everything, which makes it a filter-only
call. Tags are matched as containment: a record must carry every tag you list.
Results are ordered by name.

To filter by tag, use `tags` rather than the query string — the SQLite adapter
happens to match the query against tag text as well, but Postgres and Supabase
do not. See [backend differences](backends.md#differences-worth-knowing).

Expired records are filtered out even when a purge has not yet removed them.

### `list(opts?): Promise<CredentialMeta[]>`

Every credential's metadata, optionally filtered.

```ts
await vault.list();
await vault.list({ namespace: 'production', tags: ['payments'] });
```

```ts
interface ListOptions {
  tags?: string[];
  namespace?: string;
}
```

`list()` is `search('')` with the same filters. Note that, unlike `get` and
`put`, **it does not default to the `default` namespace** — with no `namespace`
it spans all of them.

### `remove(name, opts?): Promise<boolean>`

Delete a credential permanently. Returns `true` if one was there, `false` if
nothing matched.

```ts
if (!(await vault.remove('old-token'))) {
  console.warn('nothing was there to delete');
}
```

The boolean matters because deleting is the one operation with nothing to check
afterwards: a mistyped name removes nothing and otherwise looks exactly like a
removal that worked.

There is no undo and no copy is kept.

### `purgeExpired(): Promise<number>`

Delete every record whose expiry has passed, across all namespaces. Returns how
many rows were deleted.

```ts
setInterval(() => void vault.purgeExpired(), 60 * 60 * 1000);
```

Expiries are already enforced on read, so this is physical cleanup rather than a
security control — but leaving dead ciphertext in the database is not a habit
worth keeping. The MCP server calls it at startup and hourly.

---

## `Crypto`

AES-256-GCM sealing. You normally construct one and hand it to a `Vault`; the
methods are public so that a custom store can use the same primitives.

```ts
new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! });
```

```ts
interface CryptoOptions {
  /** base64-encoded 32-byte active key */
  key: string;
  /** identifier stamped on newly sealed records; default 'default' */
  keyId?: string;
  /** keyId -> base64 key, for opening records sealed under old keys */
  keys?: Record<string, string>;
}
```

A key that does not decode to exactly 32 bytes is refused at construction:
`cryptofort: master key must decode to 32 bytes, got N`.

### `seal(plaintext, aad?): Promise<Sealed>`

```ts
interface Sealed {
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  keyId: string;
}
```

A fresh random 12-byte IV is generated per seal. `aad` is additional
authenticated data: bound into the GCM tag but **not stored**, so whoever opens
the record must supply the same value. The vault passes
`` `${namespace}\0${name}` ``, which is what stops a ciphertext being moved to
another record or namespace — the tag check fails instead of the wrong secret
coming back.

### `open(sealed, aad?): Promise<string>`

Decrypt, verifying the tag. Throws if the ciphertext, IV, tag, or `aad` does not
match, and throws `cryptofort: no key available for keyId '<id>'` when the
record names a key this instance was not given.

### `generateKey(): string`

32 cryptographically random bytes, base64-encoded — a master key.

```ts
import { generateKey } from 'cryptofort';
console.log(generateKey());
```

---

## Adapters

All three implement `CredentialStore` and treat the sealed secret as opaque —
an adapter never encrypts, never decrypts, and never inspects a ciphertext.

Call `init()` once before use. It is idempotent: it creates the schema when it
is missing and does nothing when it is not, so calling it on every startup is
correct.

### `SqliteAdapter`

```ts
new SqliteAdapter(path?: string); // default: 'cryptofort.db'
```

Requires `better-sqlite3`, imported lazily inside `init()` so that merely
importing CryptoFort does not require the native driver to be installed.

### `PostgresAdapter`

```ts
import postgres from 'postgres';
import { PostgresAdapter } from 'cryptofort';

const adapter = new PostgresAdapter(postgres(process.env.DATABASE_URL!));
await adapter.init();
```

Takes an already-constructed `postgres` tagged-template client, so connection
pooling, TLS, and timeouts stay yours to configure.

### `SupabaseAdapter`

```ts
import { createClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from 'cryptofort';

const adapter = new SupabaseAdapter(createClient(url, serviceRoleKey), {
  provisioner, // optional: a `postgres` client, used only to create the schema
});
await adapter.init();
```

The Supabase client speaks PostgREST, which cannot run DDL, so creating the
table needs a direct Postgres connection passed as `provisioner`. Without one,
`init()` is a no-op when the table exists and throws a clear error when it does
not. See [backends](backends.md#supabase).

### `CredentialStore`

The contract to implement for a backend of your own:

```ts
interface CredentialStore {
  init(): Promise<void>;
  insert(row: SealedRecord): Promise<void>;
  update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void>;
  findByName(namespace: string, name: string): Promise<SealedRecord | null>;
  searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]>;
  listMeta(opts: ListOptions): Promise<CredentialMeta[]>;
  remove(namespace: string, name: string): Promise<void>;
  removeExpired(now: string): Promise<number>;
  touchAccessed(namespace: string, name: string): Promise<void>;
}
```

[CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-backend-adapter) has the rules an
implementation has to hold to.

---

## Types

### `CredentialMeta`

What `search` and `list` return — everything except the secret.

```ts
interface CredentialMeta {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string[];
  provider: string | null;
  metadata: Record<string, unknown>;
  createdAt: string; // ISO 8601
  updatedAt: string;
  lastAccessedAt: string | null;
  expiresAt: string | null;
}
```

### `SealedSecret` and `SealedRecord`

```ts
interface SealedSecret {
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  keyId: string;
}

interface SealedRecord extends CredentialMeta, SealedSecret {}
```

`SealedRecord` is the row shape adapters store. Application code does not
normally handle it — the vault seals and opens on your behalf.

### `DEFAULT_NAMESPACE`

```ts
const DEFAULT_NAMESPACE = 'default';
```

What `put`, `get`, and `remove` use when no namespace is given.
