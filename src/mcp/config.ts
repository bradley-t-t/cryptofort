import { Crypto } from '../crypto.js';
import { SqliteAdapter } from '../adapters/sqlite.js';
import { SupabaseAdapter } from '../adapters/supabase.js';
import { PostgresAdapter, type Sql } from '../adapters/postgres.js';
import type { CredentialStore } from '../adapters/types.js';
import { readEnv, requireEnv } from './env.js';

export function cryptoFromEnv(): Crypto {
  const key = requireEnv('CRYPTOFORT_MASTER_KEY');
  const keyId = readEnv('CRYPTOFORT_KEY_ID') ?? 'default';
  return new Crypto({ key, keyId });
}

export async function adapterFromEnv(): Promise<CredentialStore> {
  const kind = (readEnv('CRYPTOFORT_ADAPTER') ?? 'supabase').toLowerCase();
  if (kind === 'sqlite') {
    // A database path is a filesystem location rather than anything that
    // reaches a request, so it keeps the spaces and non-ASCII a real directory
    // name can carry.
    const adapter = new SqliteAdapter(readEnv('CRYPTOFORT_SQLITE_PATH', 'path') ?? 'cryptofort.db');
    await adapter.init();
    return adapter;
  }
  if (kind === 'postgres') {
    const { default: postgres } = await import('postgres');
    const url = requireEnv('CRYPTOFORT_POSTGRES_URL');
    const adapter = new PostgresAdapter(postgres(url) as unknown as Sql);
    await adapter.init();
    return adapter;
  }
  if (kind === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const url = readEnv('SUPABASE_URL');
    const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) {
      throw new Error('cryptofort: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
    }
    // PostgREST cannot run DDL, so auto-provisioning the schema needs a direct
    // Postgres connection. Optional: without it, init() is a no-op when the
    // table already exists and a clear error if it is missing.
    let provisioner: Sql | undefined;
    const dbUrl = readEnv('CRYPTOFORT_SUPABASE_DB_URL');
    if (dbUrl) {
      const { default: postgres } = await import('postgres');
      provisioner = postgres(dbUrl) as unknown as Sql;
    }
    const adapter = new SupabaseAdapter(createClient(url, serviceKey), { provisioner });
    await adapter.init();
    // The provisioning connection is only needed for the one-time DDL; close it
    // so the long-running server does not hold an idle Postgres pool open.
    if (provisioner) await (provisioner as unknown as { end?: () => Promise<void> }).end?.();
    return adapter;
  }
  throw new Error(`cryptofort: unknown CRYPTOFORT_ADAPTER '${kind}'`);
}
