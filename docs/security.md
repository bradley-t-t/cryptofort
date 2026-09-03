# Security model

This page explains what CryptoFort actually does, so you can judge what it does
and does not protect you from. [SECURITY.md](../SECURITY.md) is the reporting
policy; this is the reasoning behind it.

## What is encrypted, and what is not

**Only the `secret` field is encrypted.**

| Field                                                 | Stored as  |
| :---------------------------------------------------- | :--------- |
| `secret`                                              | Ciphertext |
| `name`, `description`, `provider`, `tags`, `metadata` | Plaintext  |
| `namespace`, timestamps, `expiresAt`, `keyId`         | Plaintext  |

That is a deliberate trade: search and listing work without decrypting anything,
which is what lets the MCP server answer "what does this vault hold?" without a
key ever being used and without a secret ever leaving the database.

The consequence is the single most important rule when using CryptoFort:

> **Never put a secret in a name, a description, a provider, a tag, or a
> metadata value.** Anyone who can read the table can read all of them.

Metadata also reveals shape — that you hold a Stripe live key, which services
have production credentials, when a token was last used. If that inference is
itself sensitive in your setting, the vault is not the place to record it.

## How a secret is sealed

Each secret is encrypted with **AES-256-GCM** — authenticated encryption, so
tampering is detected rather than decrypting to garbage.

- **The key** is 32 bytes, read from `CRYPTOFORT_MASTER_KEY`, never written to
  the database.
- **The IV** is 12 fresh random bytes per seal, stored beside the ciphertext.
  Because it is regenerated on every `put`, the same secret written twice
  produces different ciphertext.
- **The tag** is 16 bytes, stored in its own column, and verified on every read.
- **The additional authenticated data** is `` `${namespace}\0${name}` ``. It is
  bound into the tag but **not stored**.

That last one is the part worth dwelling on. Because the record's identity is
authenticated along with the secret, a ciphertext cannot be moved: copy the
sealed columns of `staging/db-url` over `production/db-url`, and the read fails
the tag check instead of returning the staging secret under the production name.
Someone with write access to the table can destroy a record, but cannot
substitute one for another and have it open.

Records written before AAD binding existed were sealed without it, so `get`
retries once without the AAD to keep them readable, and they pick up the binding
the next time they are `put`. A tampered or swapped record fails the
second attempt too, so the error still surfaces.

## The permission model

The MCP server's permissions are enforced **by omission**. A server started
without `--allow-secret-read` does not register `credential_get` at all — the
tool is not in the list, so there is nothing to call and no refusal to argue
with. Same for `--allow-write` and `--allow-delete`.

This matters because the alternative — registering every tool and having the
handler check a flag — makes the boundary a matter of the model behaving well.
Here it is a matter of what exists.

Why three flags rather than one:

- **Reading a secret** is the only operation that produces plaintext. Everything
  it touches — the caller's memory, its logs, an agent's transcript — now holds
  the credential.
- **Writing** is recoverable. A wrong `put` can be put again; a purge only
  removes what an expiry had already killed.
- **Deleting** is not recoverable at all. There is no copy and no undo, so a
  caller that stores credentials should not be forced to hold the permission
  that loses them.

### The transcript problem

The reason the default server serves metadata only is worth stating directly.

A conversational agent keeps what it is told. A secret returned into a chat
session is written into that session's transcript, and the transcript is stored,
synced, and often reviewed — so the credential outlives, by weeks, the operation
it was fetched for. It is now in a place with a completely different security
posture from the vault it came out of.

So the shape to aim for is: the agent finds _which_ credential is needed
(metadata, no key involved), and a process that runs one operation with the value
fetches it and exits. Two servers against the same vault — one metadata-only for
the agent, one `--allow-secret-read` for the worker — is a normal configuration.

The same logic applies in reverse to `credential_put`: to store a secret through
a chat, the secret has to be typed into the chat. Seed vaults from a script that
reads the value out of the environment.

## Expiry

A credential with `expiresAt` set stops being available the instant that time
passes — not when a sweep gets round to it:

- `get` finds it expired, **deletes the record**, and returns `null`.
- `search` and `list` filter it out, even while the row is still there.
- `purgeExpired()` deletes the rows physically. The MCP server runs it at
  startup and hourly, regardless of `--allow-write`, because it enforces a
  decision the vault owner already made rather than taking a new one.

Timestamps are normalized to canonical UTC on write. That is not cosmetic: on
SQLite the column is compared as text, so a value in a different offset or
format would sort wrongly and its expiry would silently fail to fire.

Expiry limits exposure over time. It is not a revocation mechanism — if a secret
has leaked, rotate it at the provider. Deleting the vault's copy does nothing
about the copy someone else has.

## Handling the master key

The key is the whole of the vault's security. A database dump without it is
inert; the two together are a complete compromise.

- **Generate it properly.** 32 random bytes:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  or `generateKey()`. Not a passphrase, not a UUID, not something memorable.
- **Store it in a secret manager**, a CI secret, or your host's environment
  settings — never in the repository, an image layer, a log line, or the
  database it unlocks.
- **One key per environment.** Sharing a key between development and production
  makes a development leak a production leak.
- **Whoever can start the process has the vault.** The MCP server holds the key
  for its lifetime. Scope who can launch it accordingly.
- **A key that is lost is a vault that is gone.** There is no recovery path and
  no escrow. Back the key up somewhere separate from the database — separate,
  because a backup holding both is a backup of the plaintext.

### Rotating the master key

`keyId` is stamped on every record, which is what makes rotation possible: old
records stay readable under the key that sealed them while new writes use the
new one.

```ts
import { Vault, Crypto } from 'cryptofort';

const crypto = new Crypto({
  key: process.env.CRYPTOFORT_NEW_KEY!, // seals everything from now on
  keyId: '2026-09', // stamped on new records
  keys: {
    '2026-09': process.env.CRYPTOFORT_NEW_KEY!,
    default: process.env.CRYPTOFORT_OLD_KEY!, // still opens old records
  },
});

const vault = new Vault({ adapter, crypto });

// Re-seal everything under the new key.
for (const meta of await vault.list()) {
  const secret = await vault.get(meta.name, { namespace: meta.namespace });
  if (secret !== null) {
    await vault.put({ name: meta.name, secret, namespace: meta.namespace });
  }
}
```

Once no record names the old `keyId`, drop it from `keys` and destroy the old
key.

Two limits to know:

- **The MCP server cannot do this.** It builds its `Crypto` from
  `CRYPTOFORT_MASTER_KEY` and `CRYPTOFORT_KEY_ID` — a single key, with no `keys`
  map read from the environment. Rotate with a script that uses the library,
  then restart the server with the new key and key id.
- **Re-encrypting is not rotating the credentials.** If the old key leaked,
  everything it sealed should be considered read. Rotate those credentials at
  their providers; re-sealing them under a new key helps nobody who already has
  the plaintext.

## Other properties

- **Search terms cannot become filters.** A query is escaped before it reaches
  PostgREST's filter grammar, where commas and dots are syntax, and
  parameterised on Postgres and SQLite. A query string cannot inject a
  condition.
- **Configuration is refused rather than mangled.** Environment values are
  checked as they enter the process; a masked value copied from a UI, a smart
  quote, a non-breaking space, or a carriage return is refused by name and
  position instead of producing an inscrutable failure inside an HTTP client
  later. See [configuration](configuration.md#how-values-are-validated).
- **Diagnostics never carry secrets.** The MCP server logs to stderr, and what
  it logs is which permissions are on and how many rows a purge removed.
- **Row-level security is enabled on Supabase** as defense in depth. With no
  policies the anon key reads nothing. The rows hold ciphertext regardless — RLS
  is a second layer, not the first.

## What this does not give you

Stated plainly, because a security tool that is trusted for more than it does is
worse than none:

- **No authorization model.** No users, no roles, no per-caller permissions.
  Anyone with the key and a connection reads everything. Namespaces organize
  credentials; they are not a permission boundary. Deciding who may run the
  process is your layer's job.
- **No memory protection.** A decrypted secret is an ordinary JavaScript string
  — not pinned, not zeroed, copied freely by the garbage collector. A heap dump
  or a debugger on a live process can read it.
- **No audit trail.** `lastAccessedAt` records that a credential was read, not by
  whom or for what. Log attribution in the layer that calls the vault.
- **No secure deletion.** `remove` issues a `delete`. Whether the bytes survive
  in backups, WAL, or unvacuumed pages is a property of your database.
- **No protection from your backend's own credentials.** A Supabase service-role
  key is full database access by itself. A SQLite vault is as private as its
  file permissions.
- **No defense once the key is out.** Everything above assumes
  `CRYPTOFORT_MASTER_KEY` is secret. It is the single point of failure by
  design, which is why it lives in exactly one place and never in the database.

## Reporting a problem

If you have found a way to read a secret you should not be able to read, report
it privately — [SECURITY.md](../SECURITY.md) has the process. Please do not open
a public issue for it.
