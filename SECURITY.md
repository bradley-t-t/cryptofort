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

## What is and is not a vulnerability

A vulnerability is any demonstration that CryptoFort fails a property it is
written to hold, such as a stolen database staying unreadable without the master
key, or a tampered ciphertext failing to open.
[The security model](docs/security.md) lists every property it holds and the
ones it deliberately does not.

## Out of scope

The following are not accepted as vulnerabilities:

- Anything that already assumes possession of `CRYPTOFORT_MASTER_KEY`, the
  database credentials, or the host.
- The fact that the metadata columns (`name`, `description`, `provider`,
  `tags`, `metadata`) are plaintext. That is the design: search works without
  the master key.
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
