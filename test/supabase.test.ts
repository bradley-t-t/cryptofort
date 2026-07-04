import { describe, it, expect } from 'vitest';
import { SupabaseAdapter } from '../src/adapters/supabase.js';
import type { SealedRecord } from '../src/types.js';

// Minimal fake of the PostgREST query builder used by the adapter.
function fakeClient(store: Record<string, any>[]) {
  const calls: any[] = [];
  const builder = () => {
    const state: any = { filters: [], _limit: undefined, _order: undefined };
    const b: any = {
      insert: (row: any) => {
        store.push(row);
        return Promise.resolve({ error: null });
      },
      update: (patch: any) => {
        state.patch = patch;
        return b;
      },
      delete: () => {
        state.delete = true;
        return b;
      },
      select: () => b,
      eq: (col: string, val: any) => {
        state.filters.push(['eq', col, val]);
        return b;
      },
      or: (expr: string) => {
        state.filters.push(['or', expr]);
        return b;
      },
      contains: (col: string, val: any) => {
        state.filters.push(['contains', col, val]);
        return b;
      },
      order: (col: string) => {
        state._order = col;
        return b;
      },
      limit: (n: number) => {
        state._limit = n;
        return b;
      },
      maybeSingle: () => {
        calls.push(state);
        const match = store.find((r) =>
          state.filters.every(([op, c, v]: any[]) => op !== 'eq' || r[c] === v),
        );
        return Promise.resolve({ data: match ?? null, error: null });
      },
      then: (resolve: any) => {
        calls.push(state);
        if (state.delete || state.patch) {
          const idx = store.findIndex((r) =>
            state.filters.every(([op, c, v]: any[]) => op !== 'eq' || r[c] === v),
          );
          if (idx >= 0 && state.delete) store.splice(idx, 1);
          if (idx >= 0 && state.patch) Object.assign(store[idx], state.patch);
          return resolve({ error: null });
        }
        let rows = store.slice();
        for (const [op, c, v] of state.filters) {
          if (op === 'eq') rows = rows.filter((r) => r[c] === v);
        }
        if (state._limit) rows = rows.slice(0, state._limit);
        return resolve({ data: rows, error: null });
      },
    };
    return b;
  };
  return { from: () => builder(), _calls: calls };
}

function dbRow(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'id-1',
    namespace: over.namespace ?? 'default',
    name: over.name ?? 'stripe-key',
    description: over.description ?? 'Stripe',
    tags: over.tags ?? ['payments'],
    provider: over.provider ?? 'stripe',
    metadata: over.metadata ?? {},
    created_at: '2026-07-04T00:00:00.000Z',
    updated_at: '2026-07-04T00:00:00.000Z',
    last_accessed_at: null,
    secret_ciphertext: 'ct',
    secret_iv: 'iv',
    secret_tag: 'tag',
    key_id: 'default',
  };
}

describe('SupabaseAdapter', () => {
  it('findByName maps a snake_case row to a SealedRecord', async () => {
    const store = [dbRow()];
    const a = new SupabaseAdapter(fakeClient(store) as any);
    const found = await a.findByName('default', 'stripe-key');
    expect(found?.secretCiphertext).toBe('ct');
    expect(found?.tags).toEqual(['payments']);
  });

  it('insert writes a snake_case row without leaking camelCase keys', async () => {
    const store: any[] = [];
    const a = new SupabaseAdapter(fakeClient(store) as any);
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
    expect(store[0].secret_ciphertext).toBe('c');
    expect(store[0]).not.toHaveProperty('secretCiphertext');
  });

  it('searchMeta returns metadata objects without secret fields', async () => {
    const store = [dbRow()];
    const a = new SupabaseAdapter(fakeClient(store) as any);
    const hits = await a.searchMeta('', { namespace: 'default' });
    expect(hits[0]).not.toHaveProperty('secretCiphertext');
    expect(hits[0].name).toBe('stripe-key');
  });

  it('quotes the search term so it cannot break out of the or() filter', async () => {
    const client = fakeClient([]);
    const a = new SupabaseAdapter(client as any);
    await a.searchMeta('a,b)', { namespace: 'default' });
    const or = client._calls.flatMap((s: any) => s.filters).find((f: any[]) => f[0] === 'or');
    expect(or).toBeDefined();
    const expr = or[1] as string;
    // The reserved characters ride inside a quoted value; no bare comma/paren
    // leaks into the filter grammar as an injected term.
    expect(expr).toContain('name.ilike."%a,b)%"');
    expect(expr).not.toContain('ilike.%a,b)%');
  });
});
