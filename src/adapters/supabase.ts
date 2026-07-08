import type { SupabaseClient } from '@supabase/supabase-js';
import type { CredentialStore } from './types.js';
import type { Sql } from './postgres.js';
import type { CredentialMeta, ListOptions, SealedRecord, SearchOptions } from '../types.js';
import { POSTGRES_INDEX_DDL, POSTGRES_RLS_DDL, POSTGRES_TABLE_DDL, TABLE } from './schema.js';

interface DbRow {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string[];
  provider: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_accessed_at: string | null;
  secret_ciphertext: string;
  secret_iv: string;
  secret_tag: string;
  key_id: string;
}

const META_COLUMNS =
  'id, namespace, name, description, tags, provider, metadata, created_at, updated_at, last_accessed_at';

function toMeta(r: DbRow): CredentialMeta {
  return {
    id: r.id,
    namespace: r.namespace,
    name: r.name,
    description: r.description,
    tags: r.tags ?? [],
    provider: r.provider,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at,
  };
}

function toRecord(r: DbRow): SealedRecord {
  return {
    ...toMeta(r),
    secretCiphertext: r.secret_ciphertext,
    secretIv: r.secret_iv,
    secretTag: r.secret_tag,
    keyId: r.key_id,
  };
}

function toDbInsert(row: SealedRecord): DbRow {
  return {
    id: row.id,
    namespace: row.namespace,
    name: row.name,
    description: row.description,
    tags: row.tags,
    provider: row.provider,
    metadata: row.metadata,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    last_accessed_at: row.lastAccessedAt,
    secret_ciphertext: row.secretCiphertext,
    secret_iv: row.secretIv,
    secret_tag: row.secretTag,
    key_id: row.keyId,
  };
}

function patchToDb(patch: Partial<SealedRecord>): Record<string, unknown> {
  const map: Record<string, string> = {
    description: 'description',
    tags: 'tags',
    provider: 'provider',
    metadata: 'metadata',
    updatedAt: 'updated_at',
    lastAccessedAt: 'last_accessed_at',
    secretCiphertext: 'secret_ciphertext',
    secretIv: 'secret_iv',
    secretTag: 'secret_tag',
    keyId: 'key_id',
  };
  const out: Record<string, unknown> = {};
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) out[col] = (patch as Record<string, unknown>)[k];
  }
  return out;
}

/** Postgres/PostgREST "relation does not exist" signals for a missing table. */
function isUndefinedTable(err: { code?: string; message?: string }): boolean {
  const code = err.code ?? '';
  const msg = err.message ?? '';
  // 42P01 is the Postgres undefined_table SQLSTATE; PGRST205 is PostgREST's
  // "Could not find the table ... in the schema cache".
  return code === '42P01' || code === 'PGRST205' || /does not exist|find the table/i.test(msg);
}

export interface SupabaseAdapterOptions {
  // A direct Postgres connection used only to create the schema when it is
  // missing (PostgREST cannot run DDL). Reads and writes still go through the
  // Supabase client. Wire it from CRYPTOFORT_SUPABASE_DB_URL — see config.
  provisioner?: Sql;
}

export class SupabaseAdapter implements CredentialStore {
  private readonly provisioner?: Sql;

  constructor(
    private readonly client: SupabaseClient,
    opts: SupabaseAdapterOptions = {},
  ) {
    this.provisioner = opts.provisioner;
  }

  // Build the table on first connect if it does not exist. The Supabase client
  // speaks PostgREST, which cannot run DDL, so provisioning needs a direct
  // Postgres connection. When the table already exists this is a cheap probe
  // and a no-op, so it is safe to call on every startup.
  async init(): Promise<void> {
    const { error } = await this.client.from(TABLE).select('id').limit(1);
    if (!error) return;
    if (!isUndefinedTable(error)) {
      // Auth/network/other error — not a missing table. Don't provision over a
      // real problem, and don't take down a previously-working server: warn and
      // let the actual operations surface the issue.
      console.error(`cryptofort: could not verify Supabase schema: ${error.message}`);
      return;
    }
    if (!this.provisioner) {
      throw new Error(
        `cryptofort: table "${TABLE}" does not exist and no provisioning connection is configured. ` +
          `Set CRYPTOFORT_SUPABASE_DB_URL to a direct Postgres connection string so CryptoFort can ` +
          `create the schema automatically.`,
      );
    }
    await this.provisioner.unsafe(POSTGRES_TABLE_DDL);
    for (const ddl of POSTGRES_INDEX_DDL) await this.provisioner.unsafe(ddl);
    await this.provisioner.unsafe(POSTGRES_RLS_DDL);
  }

  async insert(row: SealedRecord): Promise<void> {
    const { error } = await this.client.from(TABLE).insert(toDbInsert(row));
    if (error) throw new Error(`cryptofort: insert failed: ${error.message}`);
  }

  async update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update(patchToDb(patch))
      .eq('namespace', namespace)
      .eq('name', name);
    if (error) throw new Error(`cryptofort: update failed: ${error.message}`);
  }

  async findByName(namespace: string, name: string): Promise<SealedRecord | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('namespace', namespace)
      .eq('name', name)
      .maybeSingle();
    if (error) throw new Error(`cryptofort: findByName failed: ${error.message}`);
    return data ? toRecord(data as DbRow) : null;
  }

  async searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]> {
    let q = this.client.from(TABLE).select(META_COLUMNS);
    if (opts.namespace) q = q.eq('namespace', opts.namespace);
    if (query) {
      // PostgREST parses the .or() argument as a filter grammar (commas separate
      // terms, dots split column.op.value), so an unescaped query can break out
      // of the ilike term and inject conditions. Wrap the value in double quotes
      // and escape backslashes and quotes so reserved characters stay literal.
      const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const like = `"%${escaped}%"`;
      q = q.or(`name.ilike.${like},description.ilike.${like},provider.ilike.${like}`);
    }
    if (opts.tags && opts.tags.length) q = q.contains('tags', opts.tags);
    q = q.order('name');
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`cryptofort: search failed: ${error.message}`);
    return (data as DbRow[]).map(toMeta);
  }

  async listMeta(opts: ListOptions): Promise<CredentialMeta[]> {
    return this.searchMeta('', { namespace: opts.namespace, tags: opts.tags });
  }

  async remove(namespace: string, name: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .delete()
      .eq('namespace', namespace)
      .eq('name', name);
    if (error) throw new Error(`cryptofort: remove failed: ${error.message}`);
  }

  async touchAccessed(namespace: string, name: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('namespace', namespace)
      .eq('name', name);
    if (error) throw new Error(`cryptofort: touch failed: ${error.message}`);
  }
}
