import { describe, it, expect } from 'vitest';
import { PostgresAdapter } from '../src/adapters/postgres.js';
import type { SealedRecord } from '../src/types.js';

// Fake porsager `sql`: records tagged-template queries and object fragments,
// returns queued row results. Mirrors how porsager distinguishes a template
// call (first arg is a TemplateStringsArray with `.raw`) from the `sql(obj)`
// helper used to build insert/update payloads.
function fakeSql() {
  const calls: { strings: string[]; args: unknown[] }[] = [];
  const fragments: any[] = [];
  const results: any[][] = [];
  const sql: any = (first: any, ...rest: any[]) => {
    const isTemplate = Array.isArray(first) && 'raw' in first;
    if (!isTemplate) {
      // sql(object) helper -> a fragment capturing the payload.
      fragments.push(first);
      return { __fragment: first };
    }
    calls.push({ strings: Array.from(first), args: rest });
    return Promise.resolve(results.shift() ?? []);
  };
  sql.unsafe = (s: string) => ({ unsafe: s });
  sql._calls = calls;
  sql._fragments = fragments;
  sql._queue = (rows: any[]) => results.push(rows);
  return sql;
}

function dbRow(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'id-1',
    namespace: 'default',
    name: over.name ?? 'stripe-key',
    description: 'Stripe',
    tags: over.tags ?? ['payments'],
    provider: 'stripe',
    metadata: {},
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_accessed_at: null,
    secret_ciphertext: 'ct',
    secret_iv: 'iv',
    secret_tag: 'tag',
    key_id: 'default',
  };
}

describe('PostgresAdapter', () => {
  it('findByName maps a row to a SealedRecord', async () => {
    const sql = fakeSql();
    sql._queue([dbRow()]);
    const a = new PostgresAdapter(sql);
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct');
    expect(found?.tags).toEqual(['payments']);
  });

  it('findByName returns null when no row', async () => {
    const sql = fakeSql();
    sql._queue([]);
    const a = new PostgresAdapter(sql);
    expect(await a.findByName('default', 'x')).toBeNull();
  });

  it('searchMeta returns metadata without secret fields', async () => {
    const sql = fakeSql();
    sql._queue([dbRow()]);
    const a = new PostgresAdapter(sql);
    const hits = await a.searchMeta('stripe', {});
    expect(hits[0]).not.toHaveProperty('secretCiphertext');
    expect(hits[0].name).toBe('stripe-key');
  });

  it('insert builds a snake_case payload fragment', async () => {
    const sql = fakeSql();
    const a = new PostgresAdapter(sql);
    const rec: SealedRecord = {
      id: 'id-9',
      namespace: 'default',
      name: 'k',
      description: null,
      tags: ['t'],
      provider: null,
      metadata: {},
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
      lastAccessedAt: null,
      secretCiphertext: 'c',
      secretIv: 'i',
      secretTag: 'g',
      keyId: 'default',
    };
    await a.insert(rec);
    const payload = sql._fragments.at(-1) as Record<string, unknown>;
    expect(payload.secret_ciphertext).toBe('c');
    expect(payload).not.toHaveProperty('secretCiphertext');
  });

  it('update builds a snake_case patch fragment', async () => {
    const sql = fakeSql();
    const a = new PostgresAdapter(sql);
    await a.update('default', 'k', { secretCiphertext: 'c2', description: 'new' });
    const payload = sql._fragments.at(-1) as Record<string, unknown>;
    expect(payload.secret_ciphertext).toBe('c2');
    expect(payload.description).toBe('new');
    expect(payload).not.toHaveProperty('secretCiphertext');
  });
});
