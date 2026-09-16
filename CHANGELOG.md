# Changelog

All notable changes to CryptoFort are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are calendar-based — `YEAR.WEEK.PATCH` — rather than semantic, so read
the entries rather than the number to judge whether an upgrade is breaking.
Breaking changes are always listed under **Changed** or **Removed** and called
out as breaking.

## 2026.38.0 - 2026-09-15

### Added

- `npm run lint:fix`, so you no longer have to apply ESLint's fixes by hand.

### Changed

- The lint configuration is `eslint.config.js` rather than `.eslintrc.cjs`.
  ESLint 10 reads only the flat format; the rules themselves are unchanged.
- ESLint 10, Vitest 5, Zod 4.6 and `@supabase/supabase-js` 2.116.

### Removed

- `.npmignore`. The `files` field in `package.json` already decides what ships,
  and it takes precedence, so the list had no effect on any published tarball.

## 2026.37.0 - 2026-09-09

### Changed

- Toolchain and driver updates: `@supabase/supabase-js`, `@types/node`,
  `@types/better-sqlite3`, and the grouped development tooling.

## 2026.36.2 - 2026-09-03

### Fixed

- Documentation corrected wherever it disagreed with the code.

## 2026.36.1 - 2026-09-02

### Changed

- `better-sqlite3` 11 to 13, Vitest 3 to 4, `@supabase/supabase-js`, the
  grouped development tooling, and the GitHub Actions CI runs on.
- American spellings throughout the documentation.

## 2026.36.0 - 2026-09-01

### Added

- `LICENSE` — the MIT text the package and README have always referred to.
- `CONTRIBUTING.md` — setup, the checks CI runs, the `develop` → `main` flow,
  commit and code conventions, and how to add a backend adapter or an MCP tool.
- `SECURITY.md` — private vulnerability reporting, and an explicit statement of
  what CryptoFort defends against and what it does not.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `docs/` — a manual covering getting started, configuration, the library API,
  the MCP server, backends, the security model, and troubleshooting.
- Issue and pull request templates, and a Dependabot configuration for npm and
  GitHub Actions.
- `.editorconfig` and `.nvmrc` so a fresh checkout picks up the project's
  whitespace and Node version.

## Earlier releases

Releases published before this file existed are listed on the
[releases page](https://github.com/bradley-t-t/cryptofort/releases).
