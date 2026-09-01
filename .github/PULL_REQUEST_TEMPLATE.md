<!--
Thanks for the pull request.

Open it against `develop` — `main` carries releases only.

If this fixes a security issue that has not been disclosed yet, please stop and
report it privately first: SECURITY.md.
-->

## What this changes

<!-- One or two sentences. What does CryptoFort do now that it did not before,
     or stop doing that it did? -->

## Why

<!-- The problem this solves. Link the issue it closes: "Closes #123". -->

## How it was verified

<!-- The commands you ran and what they told you. Say so plainly if something
     could not be tested, and why. -->

```
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Checklist

- [ ] The five commands above pass locally.
- [ ] Behavior I added or changed is covered by a test.
- [ ] The README and `docs/` match the behavior after this change.
- [ ] `CHANGELOG.md` has an entry under **Unreleased**, if a user would notice this change.
- [ ] No secret, key, or connection string appears anywhere in the diff — including tests and fixtures.
- [ ] Commits are authored under my own name and email, with no AI attribution trailers (CI refuses them).

## Security impact

<!-- Delete this section if the change cannot affect what a caller can reach. -->

- [ ] This changes what an MCP caller can do, or which permission gates it.
- [ ] This touches encryption, key handling, or expiry enforcement.
- [ ] This adds a new place a secret is read, written, or logged.

<!-- If any box above is ticked, describe what widens and why it is safe. -->
