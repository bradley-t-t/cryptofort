# Troubleshooting

CryptoFort's errors are written to name the thing that is wrong. This page maps
each one to what it means and what clears it.

Every message is prefixed `cryptofort:`. Anything without that prefix came from
a driver, the MCP SDK, or Node itself.

## Configuration

### `cryptofort: CRYPTOFORT_MASTER_KEY is required`

The variable is unset, empty, or held nothing but whitespace and invisible
characters. Under an MCP client, the `env` block in your client configuration is
the environment the server gets — your shell's exports do not reach it.

### `cryptofort: master key must decode to 32 bytes, got N`

The key is not 32 bytes of base64. Generate one properly:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`got 24` usually means a truncated paste; `got 44` usually means the base64 text
was itself base64-encoded again.

### `cryptofort: <VAR> contains U+XXXX at index N, which cannot be sent in an HTTP header or a connection string`

The value has a character outside printable ASCII. Almost always one of:

| What                       | Where it comes from                              |
| :------------------------- | :----------------------------------------------- |
| U+00A0 non-breaking space  | Copying from a web page or a PDF                 |
| U+2018–U+201D smart quotes | A word processor or a chat client autocorrecting |
| U+000A / U+000D line break | A wrapped value pasted across two lines          |
| Accented letters, emoji    | The wrong value entirely                         |

The message gives the index. Retype that part of the value.

### `cryptofort: <VAR> holds a masked value, not a credential`

You copied the **display** of a secret rather than its value — the `••••••••`
a UI shows in place of the part it hides. Reveal the value at its source, or
regenerate the credential, and set it again.

### `cryptofort: unknown CRYPTOFORT_ADAPTER '<value>'`

The only accepted values are `supabase` (the default), `postgres`, and `sqlite`.
Matching is case-insensitive; the typical cause is a typo or a trailing
character.

### `cryptofort: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required`

The Supabase adapter is selected — including by default, when
`CRYPTOFORT_ADAPTER` is unset — and one of the two is missing. If you meant to
use SQLite, set `CRYPTOFORT_ADAPTER=sqlite`.

## Schema

### `cryptofort: table "cryptofort_credentials" does not exist and no provisioning connection is configured`

Supabase only. PostgREST cannot run DDL, so creating the table needs a direct
Postgres connection. Either set `CRYPTOFORT_SUPABASE_DB_URL` to your project's
direct connection string and restart, or
[create the table by hand](backends.md#creating-the-table-by-hand).

### `cryptofort: table "cryptofort_credentials" is missing the expires_at column …`

A warning, not a failure. The table was created before expiry support existed.
The vault keeps working without expiry; writes that set `expiresAt` will fail
until the column is added. Set `CRYPTOFORT_SUPABASE_DB_URL` and restart, or run:

```sql
alter table cryptofort_credentials add column expires_at timestamptz;
```

### `cryptofort: could not verify Supabase schema: <message>`

`init()` hit something that was not a missing table — an auth failure, a network
problem, a paused project. It warns rather than provisioning over a real
problem, and lets the actual operations surface it. Check the URL and the
service-role key first.

### `cryptofort: SqliteAdapter.init() must be called before use`

Construct the adapter, `await adapter.init()`, then build the `Vault`. `init()`
is what opens the database.

## Reads and writes

### `get()` returns `null` when you expect a value

Four possibilities, in order of likelihood:

1. **Wrong namespace.** `get` defaults to `default`, while `search` and `list`
   span every namespace — so a credential you can see in a search may be in
   another namespace. `search` results carry the `namespace` field; pass it.
2. **The name is not exact.** `get` matches exactly; `search` matches
   substrings.
3. **It expired.** The record is deleted at that moment, so it is now gone.
4. **A different vault.** Under an MCP server, a relative
   `CRYPTOFORT_SQLITE_PATH` resolves against the client's working directory, so
   an empty database may have been created somewhere you did not intend. Use an
   absolute path.

### `OperationError` or a decryption failure from `get()`

The GCM tag did not verify. Either:

- **The key is wrong.** A different `CRYPTOFORT_MASTER_KEY` than the one that
  sealed the record — check you are not pointing a development key at a
  production vault.
- **The record was altered.** The ciphertext, IV, or tag was modified in the
  database, or a sealed value was copied over another record. That copy is what
  the AAD binding is designed to catch.

There is no repair. Re-`put` the credential with its correct value.

### `cryptofort: no key available for keyId '<id>'`

The record was sealed under a key id this `Crypto` was not given. During
rotation, pass the old key in the `keys` map:

```ts
new Crypto({
  key: newKey,
  keyId: '2026-09',
  keys: { '2026-09': newKey, default: oldKey },
});
```

The MCP server reads only a single key from the environment, so rotation has to
run through the library. See
[key rotation](security.md#rotating-the-master-key).

### `remove()` returned `false`

Nothing matched that `(namespace, name)`. It returns a boolean precisely because
a mistyped name deletes nothing and otherwise looks identical to a delete that
worked. Check the namespace.

### A `put` did not clear a field

`put` patches only the fields you pass. Omitting `tags` leaves the existing tags
alone — pass `tags: []` to clear them, and `expiresAt: null` to remove an expiry.

## The MCP server

### The client shows no CryptoFort tools

- Confirm `@modelcontextprotocol/sdk` is installed alongside CryptoFort.
- Check the client's log for the startup line. The server prints its permissions
  to stderr on every start:
  `cryptofort-mcp ready (secret read disabled, write enabled, delete disabled)`.
  If that line is absent, the process failed before connecting and the reason is
  the line above it.
- Confirm `cryptofort-mcp` is on the PATH the client uses, which is often not
  your shell's. Use an absolute path or `npx -y cryptofort-mcp`.

### `credential_get` is not offered

The server was started without `--allow-secret-read`, so the tool was never
registered. That is the default. Add the flag to `args` — after reading
[why it is off](security.md#the-transcript-problem).

The same holds for `credential_put` and `credential_purge_expired`
(`--allow-write`), and `credential_delete` (`--allow-delete`).

### The connection drops immediately, or the client reports a protocol error

Something wrote to stdout. That is the MCP channel — all diagnostics belong on
stderr. If you have embedded `buildServer` in your own process, check for a
stray `console.log`.

### Expired credentials are not going away

They are already unreadable: `get` reports them as not found and `search` and
`list` omit them, from the moment the expiry passes. What you are seeing is the
row, which the hourly sweep removes. To force it, restart the server — it sweeps
at startup — or call `vault.purgeExpired()`.

## Installation

### `better-sqlite3` fails to build

It is a native module and compiles on install. You need a build toolchain
(`build-essential` on Debian or Ubuntu, the Xcode command line tools on macOS)
and a Node version it ships a prebuild for. If you do not need SQLite, do not install it — it is an optional peer
dependency and CryptoFort imports it lazily.

### `Cannot find module 'postgres'` / `'@supabase/supabase-js'` / `'@modelcontextprotocol/sdk'`

Backend drivers and the MCP SDK are **optional peer dependencies**, so nothing
you do not use is installed for you. Install the one your `CRYPTOFORT_ADAPTER`
selects, plus the SDK if you run the MCP server.

### Node version errors

CryptoFort requires **Node 20 or newer** — it uses `crypto.subtle` and
`crypto.randomUUID` from the global Web Crypto object. Check with `node -v`.

## Still stuck

Open an [issue](https://github.com/bradley-t-t/cryptofort/issues/new/choose)
with the version, the backend, the Node version, and the smallest reproduction
you can manage.

**Redact everything first.** No master keys, no service-role keys, no connection
strings, no real secrets — not in the code, not in the logs. If the problem is a
way to read a secret you should not be able to read, report it privately
instead: [SECURITY.md](../SECURITY.md).
