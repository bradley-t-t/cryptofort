# MCP server

CryptoFort ships an MCP server, `cryptofort-mcp`, that lets an agent work with
the vault over stdio. Its defining property: **it serves metadata only unless
you say otherwise.** An agent can describe what the vault holds — names,
providers, tags, descriptions, expiry — without any tool existing that would
return a secret.

That default is the point. Whatever a conversational agent is told, it has
written into a transcript, and a secret handed to one outlives by weeks the
operation it was fetched for.

Requires `@modelcontextprotocol/sdk` installed alongside CryptoFort.

## Configuring a client

Point any MCP client at the `cryptofort-mcp` binary:

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

Or against a local SQLite file:

```json
{
  "mcpServers": {
    "cryptofort": {
      "command": "cryptofort-mcp",
      "env": {
        "CRYPTOFORT_ADAPTER": "sqlite",
        "CRYPTOFORT_SQLITE_PATH": "/absolute/path/to/vault.db",
        "CRYPTOFORT_MASTER_KEY": "<base64-32-bytes>"
      }
    }
  }
}
```

Use an **absolute** path: the server's working directory is the client's, not
yours, so a relative path quietly creates an empty vault somewhere unexpected.

If CryptoFort is not installed globally, run it through npx:

```json
"command": "npx",
"args": ["-y", "cryptofort-mcp"]
```

[Configuration](configuration.md) lists every variable.

## Permissions

Three flags, given as `args`, decide which tools exist:

```json
{
  "mcpServers": {
    "cryptofort": {
      "command": "cryptofort-mcp",
      "args": ["--allow-write"],
      "env": { "…": "…" }
    }
  }
}
```

| Flag                  | Registers                                    |
| :-------------------- | :------------------------------------------- |
| `--allow-secret-read` | `credential_get`                             |
| `--allow-write`       | `credential_put`, `credential_purge_expired` |
| `--allow-delete`      | `credential_delete`                          |

**Access is enforced by omission, not by a check inside a handler.** A server
built without a permission never registers the tools it covers, so the caller
cannot reach them at all rather than being trusted to respect a refusal. There
is no prompt that talks a default server into reading a secret, because there is
no tool there to call.

The three are separate because they answer different questions:

- **`--allow-secret-read`** hands a decrypted secret to whoever called it. Give
  it to a process that will use the value and exit — not to an agent whose
  conversation is written to disk. A dedicated session that fetches one
  credential, runs one operation, and closes is the shape this flag is for.
- **`--allow-write`** covers `credential_put` and `credential_purge_expired`.
  Both are recoverable: a put can be put again, and a purge only removes what an
  expiry had already killed.
- **`--allow-delete`** is on its own because it is the one call the vault cannot
  answer for afterwards. The secret is gone and no copy is kept, so a caller
  that stores credentials should not have to hold the permission that loses
  them.

On startup the server names every permission on stderr, whether on or off:

```
cryptofort-mcp ready (secret read disabled, write enabled, delete disabled)
```

A server that silently has more than the operator meant to give it is the
failure worth catching at the handshake, so read that line in your client's
logs after a config change.

## Tools

### `credential_search` — always available

Search by name, description, or provider; filter by tag. Returns metadata only.

| Argument    | Type       | Required |
| :---------- | :--------- | :------- |
| `query`     | `string`   | yes      |
| `tags`      | `string[]` | no       |
| `namespace` | `string`   | no       |

With no `namespace`, every namespace is searched. Expired credentials are never
returned.

### `credential_list` — always available

Credential metadata, optionally filtered.

| Argument    | Type       | Required |
| :---------- | :--------- | :------- |
| `namespace` | `string`   | no       |
| `tags`      | `string[]` | no       |

### `credential_get` — requires `--allow-secret-read`

Decrypt and return one secret by exact name.

| Argument    | Type     | Required |
| :---------- | :------- | :------- |
| `name`      | `string` | yes      |
| `namespace` | `string` | no       |

Returns `not found: <name>` when there is no such credential, when it has
expired, or when it is in a different namespace than the one searched. The
namespace defaults to `default` here, unlike search and list.

### `credential_put` — requires `--allow-write`

Create or update a credential.

| Argument      | Type             | Required |
| :------------ | :--------------- | :------- |
| `name`        | `string`         | yes      |
| `secret`      | `string`         | yes      |
| `description` | `string`         | no       |
| `tags`        | `string[]`       | no       |
| `provider`    | `string`         | no       |
| `namespace`   | `string`         | no       |
| `expiresAt`   | `string \| null` | no       |

`expiresAt` is ISO 8601; `null` clears an existing expiry. Only the optional
fields you pass are patched — see [`put`](api.md#putinput-credentialinput-promisevoid).

Worth saying plainly: a `credential_put` call puts the secret in the agent's
context, because the agent had to type it. Storing a credential through a chat
session leaves that credential in the transcript. Seeding a vault is better done
with the library, from a script that reads the value from an environment
variable.

### `credential_purge_expired` — requires `--allow-write`

Delete every credential whose expiry has passed, across all namespaces. Takes no
arguments. Returns how many were deleted.

### `credential_delete` — requires `--allow-delete`

Permanently delete a credential by exact name. No undo, no copy kept.

| Argument    | Type     | Required |
| :---------- | :------- | :------- |
| `name`      | `string` | yes      |
| `namespace` | `string` | no       |

Returns `deleted: <name>` or `not found: <name>`.

## Expiry and the purge loop

The server sweeps expired credentials at startup and every hour after that.

The sweep **does not** depend on `--allow-write`. It enforces expiries the vault
owner already set rather than making a new decision, so a metadata-only server
still honors them. When a sweep deletes anything it says so on stderr:

```
cryptofort-mcp purged 3 expired credential(s)
```

Independently of the sweep, an expired credential is unreadable the moment its
time passes: `credential_get` reports it as not found and deletes the row, and
search and list omit it.

The interval timer is unref'd, so it does not hold the process open once the
stdio channel closes.

## Embedding the server

To build a server in your own process — a custom transport, or a vault you
constructed yourself — import from `cryptofort/mcp`:

```ts
import { buildServer, buildTools, type ToolAccess } from 'cryptofort/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = buildServer(vault, { allowWrite: true });
await server.connect(new StdioServerTransport());
```

`buildTools(vault, access)` returns the tool definitions without constructing a
server, which is how the test suite asserts that a permission registers exactly
the tools it should.

```ts
interface ToolAccess {
  allowSecretRead?: boolean;
  allowWrite?: boolean;
  allowDelete?: boolean;
}
```

## Operating notes

- **stdout is the protocol channel.** All diagnostics go to stderr. Anything
  your own code prints to stdout will corrupt the MCP stream.
- **Configuration errors are one sentence.** A refused environment value is
  printed without a stack trace, because it reaches an operator through the
  client's log rather than a terminal and a trace in front of it is what stops
  it being read. Unexpected failures still get their trace.
- **The server holds the master key for its lifetime.** Anyone who can start a
  process with that environment has the vault. Scope the client's environment
  accordingly.
- **One vault, several servers is fine.** Run a metadata-only server for your
  everyday agent and a separate `--allow-secret-read` server for the process
  that actually needs values. They share the database and the key; only their
  tool surfaces differ.
