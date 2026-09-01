# CryptoFort documentation

CryptoFort is an encrypted-at-rest credential vault with a pluggable database
backend and an MCP server that hands agents metadata rather than secrets.

The [project README](../README.md) is the overview. These pages are the manual.

## Start here

| Page                                  | What it covers                                                                        |
| :------------------------------------ | :------------------------------------------------------------------------------------ |
| [Getting started](getting-started.md) | Install, generate a key, store and read your first credential, wire up an MCP client. |
| [Configuration](configuration.md)     | Every environment variable, what it is required for, and what CryptoFort refuses.     |

## Reference

| Page                                  | What it covers                                                                            |
| :------------------------------------ | :---------------------------------------------------------------------------------------- |
| [Library API](api.md)                 | `Vault`, `Crypto`, `generateKey`, the adapters, and every exported type.                  |
| [MCP server](mcp.md)                  | The six tools, the three permission flags, client configuration, and the purge loop.      |
| [Backends](backends.md)               | Supabase, Postgres, and SQLite — setup, the schema, and how they differ.                  |
| [Security model](security.md)         | The threat model, key handling and rotation, expiry semantics, and what is not protected. |
| [Troubleshooting](troubleshooting.md) | The errors CryptoFort raises, what each one means, and how to clear it.                   |

## Contributing

[CONTRIBUTING.md](../CONTRIBUTING.md) covers local setup, the checks CI runs,
and the `develop` → `main` flow. [SECURITY.md](../SECURITY.md) covers reporting
a vulnerability privately.

## The short version

```ts
import { Vault, Crypto, SqliteAdapter } from 'cryptofort';

const adapter = new SqliteAdapter('vault.db');
await adapter.init();

const vault = new Vault({
  adapter,
  crypto: new Crypto({ key: process.env.CRYPTOFORT_MASTER_KEY! }),
});

await vault.put({ name: 'stripe-secret-key', secret: 'sk_live_…', provider: 'stripe' });
await vault.search('stripe'); // metadata only — never the secret
await vault.get('stripe-secret-key'); // the decrypted secret
```

Three things are worth knowing before anything else:

1. **Only the `secret` field is encrypted.** `name`, `description`, `provider`,
   `tags`, and `metadata` are plaintext so search works without decrypting.
   Never put a secret in one of them.
2. **The master key never touches the database.** It lives in
   `CRYPTOFORT_MASTER_KEY`. A database dump without it is inert; a leak of both
   together is a total compromise.
3. **The MCP server is metadata-only by default.** `credential_get`,
   `credential_put`, and `credential_delete` each require their own flag, and a
   flag that was not given means the tool is not registered at all.
