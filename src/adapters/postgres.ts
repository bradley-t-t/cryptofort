import type { CredentialStore } from './types.js';
import type { CredentialMeta, ListOptions, SealedRecord, SearchOptions } from '../types.js';
import { POSTGRES_INDEX_DDL, POSTGRES_TABLE_DDL } from './schema.js';

/**
 * Structural subset of porsager `postgres`. Two call forms:
 * - tagged template -> runs a query, resolves to rows
 * - `sql(object)` -> a fragment used to build insert/update column lists
 */
export interface Sql {
  (strings: TemplateStringsArray, ...args: unknown[]): Promise<Record<string, unknown>[]>;
  (values: Record<string, unknown> | Record<string, unknown>[], ...columns: string[]): unknown;
  unsafe(query: string): unknown;
}

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

export class PostgresAdapter implements CredentialStore {
  constructor(private readonly sql: Sql) {}

  async init(): Promise<void> {
    await this.sql.unsafe(POSTGRES_TABLE_DDL);
    for (const ddl of POSTGRES_INDEX_DDL) await this.sql.unsafe(ddl);
  }

  async insert(row: SealedRecord): Promise<void> {
    const payload = {
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
    await this.sql`insert into cryptofort_credentials ${this.sql(payload)}`;
  }

  async update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void> {
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
    const payload: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) payload[col] = (patch as Record<string, unknown>)[k];
    }
    if (Object.keys(payload).length === 0) return;
    await this.sql`update cryptofort_credentials set ${this.sql(payload)}
      where namespace = ${namespace} and name = ${name}`;
  }

  async findByName(namespace: string, name: string): Promise<SealedRecord | null> {
    const rows = (await this.sql`select * from cryptofort_credentials
      where namespace = ${namespace} and name = ${name} limit 1`) as unknown as DbRow[];
    return rows.length ? toRecord(rows[0]) : null;
  }

  async searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]> {
    const like = `%${query}%`;
    const rows = (await this.sql`
      select id, namespace, name, description, tags, provider, metadata,
             created_at, updated_at, last_accessed_at
      from cryptofort_credentials
      where (${!opts.namespace} or namespace = ${opts.namespace ?? ''})
        and (${!query} or name ilike ${like} or description ilike ${like} or provider ilike ${like})
        and (${!opts.tags || !opts.tags.length} or tags @> ${opts.tags ?? []})
      order by name asc
      limit ${opts.limit ?? 1000}`) as unknown as DbRow[];
    return rows.map(toMeta);
  }

  async listMeta(opts: ListOptions): Promise<CredentialMeta[]> {
    return this.searchMeta('', { namespace: opts.namespace, tags: opts.tags });
  }

  async remove(namespace: string, name: string): Promise<void> {
    await this.sql`delete from cryptofort_credentials
      where namespace = ${namespace} and name = ${name}`;
  }

  async touchAccessed(namespace: string, name: string): Promise<void> {
    await this.sql`update cryptofort_credentials set last_accessed_at = now()
      where namespace = ${namespace} and name = ${name}`;
  }
}
