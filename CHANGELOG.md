# Changelog

All notable changes to CryptoFort are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are calendar-based — `YEAR.WEEK.PATCH` — rather than semantic, so read
the entries rather than the number to judge whether an upgrade is breaking.
Breaking changes are always listed under **Changed** or **Removed** and called
out as breaking.

## [2026.36.0] - 2026-09-01

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

[2026.36.0]: https://github.com/bradley-t-t/cryptofort/releases/tag/v2026.36.0
