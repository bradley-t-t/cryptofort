# Contributing to CryptoFort

Thanks for taking the time to look at CryptoFort. It is a small library with a
narrow job — sealing credentials at rest and handing agents metadata instead of
secrets — and contributions that keep it that way are very welcome.

Everything below is what the project actually enforces. If a rule here does not
match what CI does, CI is right and this document is a bug worth reporting.

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Getting set up](#getting-set-up)
- [The checks CI runs](#the-checks-ci-runs)
- [Branches and pull requests](#branches-and-pull-requests)
- [Commit messages](#commit-messages)
- [Code style](#code-style)
- [Tests](#tests)
- [Adding a backend adapter](#adding-a-backend-adapter)
- [Adding an MCP tool](#adding-an-mcp-tool)
- [Documentation](#documentation)
- [Releases](#releases)
- [Security work](#security-work)

## Ways to contribute

- **Report a bug.** Open an [issue](https://github.com/bradley-t-t/cryptofort/issues/new/choose)
  with the bug report template. A failing snippet is worth more than a
  description of one.
- **Report a vulnerability.** Not in an issue — see [SECURITY.md](SECURITY.md).
  This is a credential vault, so a flaw in it is worth reporting privately
  first.
- **Suggest a feature.** Use the feature request template. The most useful part
  is the problem, not the proposed API.
- **Improve the docs.** Anything in [`docs/`](docs/) or the README. Corrections
  are as valuable as additions; a doc that describes behavior the code does not
  have is worse than no doc.
- **Send a patch.** Small, focused pull requests get reviewed fastest.

If you are about to spend real time on something large, open an issue first so
the design can be agreed before the code is written.

## Getting set up

You need **Node 20 or newer**. CI runs the checks on Node 22.

```bash
git clone https://github.com/bradley-t-t/cryptofort.git
cd cryptofort
npm ci
```

`npm ci` installs from `package-lock.json`, which is what CI does. Use
`npm install` only when you mean to change the lockfile.

Every backend driver — `@supabase/supabase-js`, `postgres`, `better-sqlite3` —
and the MCP SDK are **optional peer dependencies** for consumers, but they are
dev dependencies here, so a full install gives you everything the test suite
needs. No database has to be running: the adapter suites drive fake clients.

Then run the same checks CI will:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

| Script                 | Does                                                 |
| :--------------------- | :--------------------------------------------------- |
| `npm run build`        | Bundle ESM, CJS, and types with tsup into `dist/`.   |
| `npm test`             | Run the Vitest suite once.                           |
| `npm run typecheck`    | `tsc --noEmit`.                                      |
| `npm run lint`         | Lint with ESLint.                                    |
| `npm run format`       | Rewrite files to Prettier's formatting.              |
| `npm run format:check` | Check formatting without rewriting, the way CI does. |

`npm test -- --watch` while you work; `npm test -- test/vault.test.ts` for one
suite.

## The checks CI runs

One required job, `check`, runs on every pull request into `develop` and `main`.
It has to pass before anything merges.

1. **No AI attribution.** The pull request's author and every commit's author,
   committer, and message are scanned. A commit authored by an AI identity, or
   carrying a `Co-authored-by:` trailer, a "generated with" line, a session
   link, or a robot mark naming one, fails the build. This applies to the
   squash commit GitHub writes as well, which is why the check lives in CI
   rather than in a local hook. Configure git with your own name and email
   before you commit.
2. **Version moved on.** Only on pull requests into `main`. The version in
   `package.json` must be strictly greater than the one on `main`, and — where
   the file exists — `public/release.json` and the README version badge must
   agree with it. Pull requests into `develop` are not version-gated, so a
   normal change does not need a bump.
3. **Install and check.** `npm ci`, then `format:check`, `lint`, `typecheck`,
   `test`, and `build`, in that order.

A separate `Attribution` workflow re-runs the first check against whatever
actually lands on `main` and `develop`, so a push that arrives by a route the
pull request gate never saw is still caught.

Run the five commands above locally and you will not be surprised.

## Branches and pull requests

The default development branch is **`develop`**. `main` carries releases.

```
your-branch  ──▶  develop  ──▶  main  ──▶  npm + GitHub Packages
   (feature)       (integration)  (release)
```

- Branch off `develop` and open your pull request against `develop`.
- Only release pull requests go from `develop` into `main`, and only those need
  a version bump.
- Keep one logical change per pull request. A formatting sweep and a behavior
  change in the same diff are two pull requests.
- Fill in the pull request template. The part that matters most is how you
  verified the change.
- Rebasing or merging `develop` back in to resolve a conflict is fine. Do not
  force-push over someone else's branch.

A pull request is ready when the five local checks pass, the description says
what changed and why, and any behavior you added or altered is covered by a
test and reflected in the docs.

## Commit messages

Write a short, capitalized, imperative summary of what the commit does, with no
type prefix:

```
Move the version gate from every develop pull request to the release
```

Not `feat:`, not `fix:`, and not a description of the files you touched. If the
change needs explaining, leave a blank line and explain it in the body — why it
was needed, not what the diff already shows.

**Do not add attribution trailers of any kind.** No `Co-authored-by:` naming a
tool, no "generated with" line, no session link, no robot mark. CI refuses them
on both the pull request and the branch, and there is nothing to fix by editing
the check. Commit under your own name and email:

```bash
git config user.name "Your Name"
git config user.email "you@example.com"
```

Co-authoring with another **person** is fine — the check only refuses AI
identities.

## Code style

Prettier and ESLint decide; `npm run format` settles any argument. The
configured style is single quotes, semicolons, trailing commas, and a 100-column
print width.

Beyond formatting, the conventions this codebase actually follows:

- **TypeScript is strict.** `strict: true` is on and `any` is off outside
  `test/`. Prefer a precise type over a cast.
- **ESM everywhere, with `.js` import specifiers.** `import { Vault } from
'./vault.js'` — the extension is required even though the file is `.ts`.
- **Comments explain why, not what.** The existing comments are the model: they
  cover the reasoning a reader cannot recover from the code — why the sealed
  secret is bound to its namespace and name, why an expired record is deleted on
  read rather than only by the purge sweep, why environment values are refused
  at the boundary. Do not narrate the line below.
- **Errors name the thing that is wrong.** Messages are prefixed `cryptofort:`
  and say which variable, table, or key was at fault and what to do about it.
- **Never log a secret.** Not in an error, not in a debug line, not in a test
  fixture that looks real. The MCP server writes diagnostics to stderr because
  stdout is the protocol channel — keep it that way.
- **The public surface is `src/index.ts`.** Anything a consumer should be able
  to import is exported there; anything not exported there is internal and can
  change.

## Tests

Vitest, one suite per unit, in `test/`:

| Suite              | Covers                                                |
| :----------------- | :---------------------------------------------------- |
| `crypto.test.ts`   | Seal/open, AAD binding, key ids, `generateKey`.       |
| `vault.test.ts`    | put/get/search/list/remove and expiry semantics.      |
| `mcp.test.ts`      | Which tools each permission combination registers.    |
| `env.test.ts`      | Sanitising and refusing environment values.           |
| `sqlite.test.ts`   | The SQLite adapter against an in-memory database.     |
| `postgres.test.ts` | The Postgres adapter against a fake `sql` tag.        |
| `supabase.test.ts` | The Supabase adapter against a fake PostgREST client. |

The adapter suites use hand-written fakes rather than a live database, so the
whole suite runs offline in seconds. Keep it that way — a test that needs a
server running is a test that stops being run.

What a change should come with:

- A **bug fix** gets a test that fails before the fix and passes after it.
- A **new behavior** gets a test for the happy path and for the edge that made
  the behavior necessary.
- A **new MCP tool** gets a case in `mcp.test.ts` asserting it appears only
  under the permission that should expose it.
- **Anything touching crypto or expiry** gets a test. These are the two places
  where a silent regression hands out a secret it should not have.

## Adding a backend adapter

Implement `CredentialStore` from
[`src/adapters/types.ts`](src/adapters/types.ts) — `init`, `insert`, `update`,
`findByName`, `searchMeta`, `listMeta`, `remove`, `removeExpired`,
`touchAccessed` — and treat the sealed secret as opaque. An adapter never
encrypts, never decrypts, and never inspects a ciphertext.

- `init()` must be **idempotent**. It is called on every startup, so it creates
  the schema when it is missing and does nothing when it is not.
- Reuse the DDL in [`src/adapters/schema.ts`](src/adapters/schema.ts) rather
  than writing new column definitions, so every backend stores the same shape.
- `(namespace, name)` is unique. `searchMeta` and `listMeta` return metadata
  only — never select the ciphertext columns into a metadata result.
- Store timestamps as ISO 8601 UTC. `removeExpired` compares against a string,
  and on SQLite that comparison is textual, so a non-canonical timestamp sorts
  wrongly and an expiry silently fails to fire.
- Add a suite modeled on an existing adapter test, and export the adapter from
  `src/index.ts`.
- Drivers stay **optional peer dependencies**: import them dynamically
  (`await import('postgres')`) so nobody installs a database client they do not
  use. If the adapter needs new configuration, wire it through
  `adapterFromEnv()` in [`src/mcp/config.ts`](src/mcp/config.ts) using
  `readEnv`/`requireEnv`, and document the variables.

## Adding an MCP tool

Tools live in `buildTools()` in [`src/mcp/server.ts`](src/mcp/server.ts).

Access is enforced **by omission**: a server built without a permission never
registers the tools that permission covers, so a caller cannot reach them at all
rather than being trusted to respect a refusal. Keep that shape — do not add a
tool that registers unconditionally and then checks a flag inside its handler.

A new tool that can read a secret belongs behind `allowSecretRead`; one that
writes belongs behind `allowWrite`; one that destroys something unrecoverable
belongs behind `allowDelete`. If it fits none of those, say so in the pull
request, because a new default-on tool widens what every existing deployment
exposes. Describe the tool in its `description` the way a caller needs to read
it, give every argument a Zod schema, and add the registration test.

## Documentation

The README is the front door and [`docs/`](docs/) is the manual. If your change
alters behavior a user can see — an environment variable, a tool, a flag, a
default — update both in the same pull request.

Docs are excluded from the published npm tarball, so they can be as long as they
need to be.

## Releases

Maintainers cut releases; contributors do not need to.

1. Bump `version` in `package.json`. The scheme is calendar-based:
   `YEAR.WEEK.PATCH`.
2. Open a release pull request from `develop` into `main`. The version gate
   checks the bump.
3. Merge, then publish a GitHub Release. That triggers the publish workflow,
   which builds, tests, and publishes to npm as `cryptofort` and to GitHub
   Packages as `@bradley-t-t/cryptofort`.

## Security work

If you have found a way to read a secret you should not be able to read, do not
open a pull request that describes it in public. Report it privately first —
[SECURITY.md](SECURITY.md) has the process — and a fix can be prepared
alongside the advisory.

Ordinary hardening that does not disclose a live weakness is a normal pull
request.

## Code of Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE) that covers the project.
