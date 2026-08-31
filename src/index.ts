export { Vault, type VaultOptions } from './vault.js';
export { Crypto, generateKey, type Sealed, type CryptoOptions } from './crypto.js';
export { SqliteAdapter } from './adapters/sqlite.js';
export { SupabaseAdapter } from './adapters/supabase.js';
export { PostgresAdapter, type Sql } from './adapters/postgres.js';
export type { CredentialStore } from './adapters/types.js';
export {
  DEFAULT_NAMESPACE,
  type SealedSecret,
  type SealedRecord,
  type CredentialMeta,
  type CredentialInput,
  type SearchOptions,
  type ListOptions,
} from './types.js';
