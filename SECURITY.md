# Security Policy

CryptoFort stores credentials. A flaw in it is a flaw in whatever it is holding,
so security reports get priority over everything else in the project.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:

**[Open a private security advisory](https://github.com/bradley-t-t/cryptofort/security/advisories/new)**

That form is visible only to the maintainers. If private reporting is
unavailable to you for any reason, open a public issue that says only that you
have a security report and asks for a private channel — no details — and one
will be arranged.

Please include, as far as you can:

- What an attacker gains, and what they need to start with.
- The affected version, backend, and Node version.
- A minimal reproduction. A failing test against this repository is ideal.
- Whether the issue is already public anywhere.

What to expect:

| Stage                                   | Target                    |
| :-------------------------------------- | :------------------------ |
| Acknowledgement that the report arrived | 3 working days            |
| Initial assessment and severity         | 7 working days            |
| Fix released, or a plan with a date     | 30 days for high severity |

You will be credited in the advisory unless you would rather not be. Please give
us a chance to release a fix before publishing; if you plan to disclose on a
fixed date, say so in the report and we will work to it.

## Supported versions

CryptoFort is versioned by calendar (`YEAR.WEEK.PATCH`). Fixes land on the
latest release; there are no long-term support branches.

| Version               | Supported |
| :-------------------- | :-------- |
| Latest release on npm | Yes       |
| Anything older        | No        |

Upgrade before reporting a bug you can only reproduce on an old version.

## What CryptoFort defends against

These are the properties the code is written to hold. A demonstration that one
of them does not hold is a vulnerability.

- **A stolen database is inert.** Every secret is sealed with AES-256-GCM and
  the master key is never written to the database. A dump, a leaked backup, or
  read access to the table yields ciphertext and nothing else.
- **A ciphertext cannot be moved.** Each secret is sealed with its
  `namespace` and `name` as additional authenticated data, so pasting one
  record's ciphertext over another — or moving it to another namespace — fails
  the GCM tag check on read instead of silently returning the wrong secret.
- **Tampering is caught.** GCM is authenticated encryption; a modified
  ciphertext, IV, or tag fails to open rather than decrypting to garbage.
- **An agent is not trusted to refuse itself.** The MCP server registers a tool
  only when the permission covering it was given at startup. Without
  `--allow-secret-read` there is no `credential_get` to call, so a prompt cannot
  argue its way into one. Reading a secret, writing, and deleting are three
  separate opt-ins.
- **An expiry is enforced on read, not only on sweep.** Once `expiresAt` has
  passed, `get` deletes the record and returns null and `search`/`list` omit it,
  even before a purge has physically removed the row.
- **A search term cannot become a filter.** Query strings are escaped before
  they reach PostgREST's filter grammar and parameterised on Postgres and
  SQLite.
- **Configuration is refused, not mangled.** Environment values are checked as
  they enter the process; a masked value pasted from a UI, a smart quote, a
  non-breaking space, or a carriage return is refused by name rather than
  producing a broken request later.

## What CryptoFort does not defend against

Equally important, and not bugs:

- **The master key plus the database is total compromise.** That is the design.
  Protecting `CRYPTOFORT_MASTER_KEY` is the operator's job — keep it out of the
  repository, out of the database, and out of anything the database's backups
  reach.
- **Metadata is plaintext, deliberately.** `name`, `description`, `provider`,
  `tags`, and the `metadata` object are stored unencrypted so search and listing
  work without decrypting anything. **Never put a secret in any of them** — not
  in a name, not in a description, not in a tag, not in a metadata value. Only
  the `secret` field is sealed.
- **A secret handed out is out.** `credential_get` and `vault.get()` return
  plaintext to the caller. If that caller is a conversational agent, the value
  is now in a transcript that will outlive the operation it was fetched for.
  Give `--allow-secret-read` to a process that uses the value and exits — not to
  a chat session.
- **There is no user model.** CryptoFort has no accounts, roles, or per-caller
  authorization. Anyone holding the key and a connection can read everything.
  Namespaces organize credentials; they are not a permission boundary.
  Authorization belongs in the layer that decides who may run the process.
- **Decrypted secrets live in ordinary memory.** Plaintext is a normal
  JavaScript string. It is not pinned, not zeroed, and may be copied by the
  garbage collector. A heap dump or a debugger on a live process can read it.
- **`lastAccessedAt` is not an audit log.** It records that a credential was
  read, not by whom. If you need attribution, log it in the layer that calls the
  vault.
- **The backend's own access control is yours.** A Supabase service-role key
  grants full database access on its own; the row-level security CryptoFort
  enables is defense in depth over encrypted rows, not the primary control. A
  SQLite vault is only as private as its file permissions.
- **Deletion is not shredding.** `remove` issues a `delete`. Recovering the row
  from backups, WAL, or unvacuumed pages is a property of your database, not of
  CryptoFort.

## Handling the master key

- Generate it properly — 32 random bytes, base64:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
  or `generateKey()` from the library. Do not derive one from a passphrase you
  chose.
- Keep it in a secret manager, a CI secret, or your host's environment settings.
  Never in the repository, an image layer, a log line, or the vault it unlocks.
- Use a **different key per environment**. A development vault sharing a key
  with production means a development leak is a production leak.
- Rotate by re-sealing: the `Crypto` class accepts a `keys` map of old key ids
  so records sealed under a previous key stay readable while you re-`put` them
  under the new one. See [`docs/security.md`](docs/security.md).
- If a key leaks, treat **every credential it sealed as compromised** and rotate
  those credentials at their source. Re-encrypting the vault under a new key
  does not help anyone who already read the plaintext.

## Out of scope

The following are not accepted as vulnerabilities:

- Anything that already assumes possession of `CRYPTOFORT_MASTER_KEY`, the
  database credentials, or the host.
- The fact that metadata columns are readable — see above.
- The fact that `--allow-secret-read` returns a secret to its caller. That is
  what the flag is for; the question of who may hold it is an operator decision.
- Dependency advisories with no demonstrated path through CryptoFort's own code.
  Report those as ordinary issues so the dependency can be bumped.
- Missing hardening headers, rate limiting, or brute-force protection.
  CryptoFort is a library and a stdio MCP server; it exposes no network service.
- Social engineering, physical access, and denial of service against your own
  database.

## Scope

This policy covers the `cryptofort` package and this repository. It does not
cover Supabase, Postgres, SQLite, the MCP SDK, or any MCP client — report those
to their own maintainers.
