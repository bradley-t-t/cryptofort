import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteAdapter } from '../src/adapters/sqlite.js';
import type { SealedRecord } from '../src/types.js';

function row(over: Partial<SealedRecord> = {}): SealedRecord {
  return {
    id: over.id ?? 'id-1',
    namespace: over.namespace ?? 'default',
    name: over.name ?? 'stripe-key',
    description: over.description ?? 'Stripe secret',
    tags: over.tags ?? ['payments', 'stripe'],
    provider: over.provider ?? 'stripe',
    metadata: over.metadata ?? { env: 'prod' },
    createdAt: over.createdAt ?? '2026-07-04T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-07-04T00:00:00.000Z',
    lastAccessedAt: over.lastAccessedAt ?? null,
    expiresAt: over.expiresAt ?? null,
    secretCiphertext: over.secretCiphertext ?? 'ct',
    secretIv: over.secretIv ?? 'iv',
    secretTag: over.secretTag ?? 'tag',
    keyId: over.keyId ?? 'default',
  };
}

describe('SqliteAdapter', () => {
  let a: SqliteAdapter;
  beforeEach(async () => {
    a = new SqliteAdapter(':memory:');
    await a.init();
  });

  it('inserts and finds by name', async () => {
    await a.insert(row());
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct');
    expect(found?.tags).toEqual(['payments', 'stripe']);
    expect(found?.metadata).toEqual({ env: 'prod' });
  });

  it('returns null for a missing name', async () => {
    expect(await a.findByName('default', 'nope')).toBeNull();
  });

  it('updates fields', async () => {
    await a.insert(row());
    await a.update('default', 'stripe-key', { secretCiphertext: 'ct2', description: 'new' });
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct2');
    expect(found?.description).toBe('new');
  });

  it('searchMeta matches name/description/provider/tags and omits secrets', async () => {
    await a.insert(row());
    await a.insert(
      row({
        id: 'id-2',
        name: 'openai-key',
        provider: 'openai',
        tags: ['ai'],
        description: 'OpenAI',
      }),
    );
    const hits = await a.searchMeta('stripe', {});
    expect(hits.map((h) => h.name)).toEqual(['stripe-key']);
    expect(hits[0]).not.toHaveProperty('secretCiphertext');
  });

  it('searchMeta filters by tag and namespace and respects limit', async () => {
    await a.insert(row({ id: 'x', tags: ['payments'] }));
    await a.insert(row({ id: 'y', name: 'other', namespace: 'proj', tags: ['payments'] }));
    const hits = await a.searchMeta('', { tags: ['payments'], namespace: 'proj' });
    expect(hits.map((h) => h.name)).toEqual(['other']);
    const limited = await a.searchMeta('', { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('listMeta returns all metadata for a namespace, no secrets', async () => {
    await a.insert(row());
    const list = await a.listMeta({});
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('secretTag');
  });

  it('remove deletes the row', async () => {
    await a.insert(row());
    await a.remove('default', 'stripe-key');
    expect(await a.findByName('default', 'stripe-key')).toBeNull();
  });

  it('touchAccessed sets lastAccessedAt', async () => {
    await a.insert(row());
    await a.touchAccessed('default', 'stripe-key');
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.lastAccessedAt).not.toBeNull();
  });

  it('round-trips expiresAt', async () => {
    await a.insert(row({ expiresAt: '2026-07-05T00:00:00.000Z' }));
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.expiresAt).toBe('2026-07-05T00:00:00.000Z');
  });

  it('removeExpired deletes rows at or before the cutoff and reports the count', async () => {
    await a.insert(row({ id: 'a', name: 'gone', expiresAt: '2026-07-01T00:00:00.000Z' }));
    await a.insert(row({ id: 'b', name: 'edge', expiresAt: '2026-07-04T00:00:00.000Z' }));
    await a.insert(row({ id: 'c', name: 'later', expiresAt: '2026-07-09T00:00:00.000Z' }));
    await a.insert(row({ id: 'd', name: 'forever' }));
    expect(await a.removeExpired('2026-07-04T00:00:00.000Z')).toBe(2);
    expect(await a.findByName('default', 'gone')).toBeNull();
    expect(await a.findByName('default', 'edge')).toBeNull();
    expect(await a.findByName('default', 'later')).not.toBeNull();
    expect(await a.findByName('default', 'forever')).not.toBeNull();
  });
});

describe('SqliteAdapter migration', () => {
  it('init adds expires_at to a database created before expiry existed', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { default: Database } = await import('better-sqlite3');
    const path = join(mkdtempSync(join(tmpdir(), 'cryptofort-')), 'legacy.db');
    const legacy = new Database(path);
    // The pre-expiry schema: no expires_at column.
    legacy.exec(`
      create table cryptofort_credentials (
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
      )`);
    legacy.close();
    const migrated = new SqliteAdapter(path);
    await migrated.init();
    await migrated.insert(row({ expiresAt: '2026-07-05T00:00:00.000Z' }));
    const found = await migrated.findByName('default', 'stripe-key');
    expect(found?.expiresAt).toBe('2026-07-05T00:00:00.000Z');
  });
});
