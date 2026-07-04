import Database from 'better-sqlite3';
import type { CredentialStore } from './types.js';
import type { CredentialMeta, ListOptions, SealedRecord, SearchOptions } from '../types.js';

interface Db {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
}

interface DbRow {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string;
  provider: string | null;
  metadata: string;
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
    tags: JSON.parse(r.tags) as string[],
    provider: r.provider,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
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

export class SqliteAdapter implements CredentialStore {
  private readonly db: Db;

  constructor(path = 'cryptofort.db') {
    this.db = new Database(path) as unknown as Db;
  }

  async init(): Promise<void> {
    this.db.exec(`
      create table if not exists cryptofort_credentials (
        id text primary key,
        namespace text not null default 'default',
        name text not null,
        description text,
        tags text not null default '[]',
        provider text,
        metadata text not null default '{}',
        created_at text not null,
        updated_at text not null,
        last_accessed_at text,
        secret_ciphertext text not null,
        secret_iv text not null,
        secret_tag text not null,
        key_id text not null default 'default',
        unique (namespace, name)
      );
    `);
  }

  async insert(row: SealedRecord): Promise<void> {
    this.db
      .prepare(
        `insert into cryptofort_credentials
         (id, namespace, name, description, tags, provider, metadata,
          created_at, updated_at, last_accessed_at,
          secret_ciphertext, secret_iv, secret_tag, key_id)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        row.id,
        row.namespace,
        row.name,
        row.description,
        JSON.stringify(row.tags),
        row.provider,
        JSON.stringify(row.metadata),
        row.createdAt,
        row.updatedAt,
        row.lastAccessedAt,
        row.secretCiphertext,
        row.secretIv,
        row.secretTag,
        row.keyId,
      );
  }

  async update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void> {
    const map: Record<string, string> = {
      description: 'description',
      provider: 'provider',
      secretCiphertext: 'secret_ciphertext',
      secretIv: 'secret_iv',
      secretTag: 'secret_tag',
      keyId: 'key_id',
      updatedAt: 'updated_at',
      lastAccessedAt: 'last_accessed_at',
    };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        sets.push(`${col} = ?`);
        vals.push((patch as Record<string, unknown>)[k]);
      }
    }
    if ('tags' in patch) {
      sets.push('tags = ?');
      vals.push(JSON.stringify(patch.tags));
    }
    if ('metadata' in patch) {
      sets.push('metadata = ?');
      vals.push(JSON.stringify(patch.metadata));
    }
    if (sets.length === 0) return;
    vals.push(namespace, name);
    this.db
      .prepare(
        `update cryptofort_credentials set ${sets.join(', ')} where namespace = ? and name = ?`,
      )
      .run(...vals);
  }

  async findByName(namespace: string, name: string): Promise<SealedRecord | null> {
    const r = this.db
      .prepare(`select * from cryptofort_credentials where namespace = ? and name = ?`)
      .get(namespace, name) as DbRow | undefined;
    return r ? toRecord(r) : null;
  }

  async searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]> {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (opts.namespace) {
      where.push('namespace = ?');
      vals.push(opts.namespace);
    }
    if (query) {
      const like = `%${query.toLowerCase()}%`;
      where.push(
        "(lower(name) like ? or lower(coalesce(description,'')) like ? or lower(coalesce(provider,'')) like ? or lower(tags) like ?)",
      );
      vals.push(like, like, like, like);
    }
    for (const tag of opts.tags ?? []) {
      where.push('tags like ?');
      vals.push(`%"${tag}"%`);
    }
    let sql = 'select * from cryptofort_credentials';
    if (where.length) sql += ' where ' + where.join(' and ');
    sql += ' order by name asc';
    if (opts.limit) sql += ` limit ${Number(opts.limit)}`;
    const rows = this.db.prepare(sql).all(...vals) as unknown as DbRow[];
    return rows.map(toMeta);
  }

  async listMeta(opts: ListOptions): Promise<CredentialMeta[]> {
    return this.searchMeta('', { namespace: opts.namespace, tags: opts.tags });
  }

  async remove(namespace: string, name: string): Promise<void> {
    this.db
      .prepare(`delete from cryptofort_credentials where namespace = ? and name = ?`)
      .run(namespace, name);
  }

  async touchAccessed(namespace: string, name: string): Promise<void> {
    this.db
      .prepare(
        `update cryptofort_credentials set last_accessed_at = ? where namespace = ? and name = ?`,
      )
      .run(new Date().toISOString(), namespace, name);
  }
}
