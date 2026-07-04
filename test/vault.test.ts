import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../src/vault.js';
import { Crypto, generateKey } from '../src/crypto.js';
import { SqliteAdapter } from '../src/adapters/sqlite.js';

async function makeVault() {
  const adapter = new SqliteAdapter(':memory:');
  await adapter.init();
  return new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
}

describe('Vault', () => {
  let vault: Vault;
  beforeEach(async () => {
    vault = await makeVault();
  });

  it('put then get returns the decrypted secret', async () => {
    await vault.put({ name: 'stripe-key', secret: 'sk_live_123', provider: 'stripe' });
    expect(await vault.get('stripe-key')).toBe('sk_live_123');
  });

  it('get returns null for a missing credential', async () => {
    expect(await vault.get('nope')).toBeNull();
  });

  it('put upserts an existing credential', async () => {
    await vault.put({ name: 'k', secret: 'v1' });
    await vault.put({ name: 'k', secret: 'v2', description: 'updated' });
    expect(await vault.get('k')).toBe('v2');
    const [meta] = await vault.search('k');
    expect(meta.description).toBe('updated');
  });

  it('search returns metadata but never the secret', async () => {
    await vault.put({ name: 'stripe-key', secret: 'sk_live_123', description: 'stripe' });
    const hits = await vault.search('stripe');
    expect(hits).toHaveLength(1);
    const serialized = JSON.stringify(hits);
    expect(serialized).not.toContain('sk_live_123');
    expect(serialized).not.toContain('secretCiphertext');
  });

  it('list returns metadata without secrets', async () => {
    await vault.put({ name: 'a', secret: 'secret-a' });
    const list = await vault.list();
    expect(JSON.stringify(list)).not.toContain('secret-a');
  });

  it('respects namespace isolation', async () => {
    await vault.put({ name: 'k', secret: 'prod', namespace: 'proj-a' });
    await vault.put({ name: 'k', secret: 'dev', namespace: 'proj-b' });
    expect(await vault.get('k', { namespace: 'proj-a' })).toBe('prod');
    expect(await vault.get('k', { namespace: 'proj-b' })).toBe('dev');
  });

  it('get updates last_accessed_at', async () => {
    await vault.put({ name: 'k', secret: 'v' });
    await vault.get('k');
    const [meta] = await vault.search('k');
    expect(meta.lastAccessedAt).not.toBeNull();
  });

  it('remove deletes the credential', async () => {
    await vault.put({ name: 'k', secret: 'v' });
    await vault.remove('k');
    expect(await vault.get('k')).toBeNull();
  });
});
