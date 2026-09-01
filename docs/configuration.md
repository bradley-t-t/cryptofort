# Configuration

CryptoFort's MCP server is configured entirely through environment variables.
The library takes its configuration as constructor arguments instead — see
[the API reference](api.md) — so nothing here is required when you build a
`Vault` yourself.

## Variables

| Variable                     | Required for         | Default         | Purpose                                                             |
| :--------------------------- | :------------------- | :-------------- | :------------------------------------------------------------------ |
| `CRYPTOFORT_MASTER_KEY`      | always               | —               | Base64-encoded 32-byte AES-256 key. Never written to the database.  |
| `CRYPTOFORT_ADAPTER`         | —                    | `supabase`      | `supabase`, `postgres`, or `sqlite`.                                |
| `CRYPTOFORT_KEY_ID`          | —                    | `default`       | Identifier stamped on newly sealed records, for key rotation.       |
| `SUPABASE_URL`               | the Supabase adapter | —               | Your project URL, `https://<ref>.supabase.co`.                      |
| `SUPABASE_SERVICE_ROLE_KEY`  | the Supabase adapter | —               | Service-role key. The anon key cannot write this table.             |
| `CRYPTOFORT_SUPABASE_DB_URL` | —                    | —               | Direct Postgres URL, used **only** to create or migrate the schema. |
| `CRYPTOFORT_POSTGRES_URL`    | the Postgres adapter | —               | Connection string for the `postgres` driver.                        |
| `CRYPTOFORT_SQLITE_PATH`     | —                    | `cryptofort.db` | SQLite database file path.                                          |

The server refuses to start when a variable it needs is missing, naming the one
that is absent.

## Choosing a backend

`CRYPTOFORT_ADAPTER` selects the adapter and therefore which other variables
matter:

```bash
# Local file. Nothing else to run.
CRYPTOFORT_ADAPTER=sqlite
CRYPTOFORT_SQLITE_PATH=/var/lib/cryptofort/vault.db

# Any Postgres.
CRYPTOFORT_ADAPTER=postgres
CRYPTOFORT_POSTGRES_URL=postgres://user:pass@host:5432/dbname

# Hosted Supabase (the default when CRYPTOFORT_ADAPTER is unset).
CRYPTOFORT_ADAPTER=supabase
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi…
CRYPTOFORT_SUPABASE_DB_URL=postgres://postgres:pass@db.abcdefgh.supabase.co:5432/postgres
```

An unrecognised value fails at startup with
`cryptofort: unknown CRYPTOFORT_ADAPTER '<value>'`.

[Backends](backends.md) covers what each one is good for and how the schema is
created.

## The master key

`CRYPTOFORT_MASTER_KEY` must decode from base64 to **exactly 32 bytes**.
Anything else is refused:

```
cryptofort: master key must decode to 32 bytes, got 24
```

Generate one properly rather than inventing a string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`CRYPTOFORT_KEY_ID` names the key that sealed a record. It is stamped on every
new record and defaults to `default`. It exists for rotation — reading records
sealed under an old key needs the library's `keys` map, which the MCP server
does not read from the environment. See
[key rotation](security.md#rotating-the-master-key).

## How values are validated

Environment values reach CryptoFort by being typed or pasted into a shell
profile, a `.env` file, or a hosting provider's settings, and several of them
are written verbatim into HTTP headers. A header value has to fit in single
bytes, so one character above U+00FF makes the request unconstructable and
`fetch` throws from inside the HTTP client — an error that names an index into a
string it does not print, arrives from no CryptoFort frame, and repeats on every
operation. A misconfigured vault ends up looking like a broken one.

So values are checked as they enter the process rather than where they break.

**Cleaned silently**, because none of it can be intended:

- Leading and trailing whitespace, including a trailing newline from a heredoc.
- A matched pair of surrounding quotes, as a `.env` file often leaves.
- Invisible characters — the byte-order mark and the zero-width family — which
  survive a copy and change a value without appearing in it.

A variable holding nothing but this noise is treated as unset.

**Refused by name**, with the character and its position:

- Anything outside printable ASCII (U+0021–U+007E) in a credential, URL, or
  identifier: a line break, a non-breaking space, a smart quote, an accented
  letter, an emoji.

```
cryptofort: SUPABASE_SERVICE_ROLE_KEY contains U+00A0 at index 12, which cannot
be sent in an HTTP header or a connection string. …
```

**Masked values get their own message**, because the remedy is different — the
value is not the credential at all:

```
cryptofort: SUPABASE_SERVICE_ROLE_KEY holds a masked value, not a credential:
U+2022 at index 8 is the character a display substitutes for the part of a
secret it hides. Copy the value itself from its source rather than the masked
display, and set it again.
```

That happens when a UI showing `sk_live_••••••••` is copied by its display
instead of its value.

`CRYPTOFORT_SQLITE_PATH` is exempt from the ASCII rule. It is a filesystem
location, not something that reaches a request, so a space or an accented
directory name is ordinary and allowed.

## Permission flags

Access to the MCP server's writing and reading tools is set by command-line
flags rather than environment variables, so it cannot be widened by a stray
variable in a shared environment:

| Flag                  | Registers                                    |
| :-------------------- | :------------------------------------------- |
| `--allow-secret-read` | `credential_get`                             |
| `--allow-write`       | `credential_put`, `credential_purge_expired` |
| `--allow-delete`      | `credential_delete`                          |

With none of them, only `credential_search` and `credential_list` exist. See
[the MCP server](mcp.md).

## A note on `.env` files

CryptoFort does not read `.env` files itself — it reads `process.env`. Load them
with your own tooling (`node --env-file=.env`, `dotenv`, your process manager)
before the vault starts.

The repository's `.gitignore` already excludes `.env` and `.env.*`. Keep it that
way: a master key in version control is a master key in every clone, every fork,
and every backup of the repository, forever.
