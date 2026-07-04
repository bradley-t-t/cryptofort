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

  it('rejects a secret blob spliced into a different record', async () => {
    const adapter = new SqliteAdapter(':memory:');
    await adapter.init();
    const v = new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
    await v.put({ name: 'low', secret: 'low-value' });
    await v.put({ name: 'high', secret: 'high-value' });
    const low = await adapter.findByName('default', 'low');
    // Move the low-value ciphertext onto the high-value record; the aad binding
    // must make the swap fail to decrypt rather than leak 'low-value' as 'high'.
    await adapter.update('default', 'high', {
      secretCiphertext: low!.secretCiphertext,
      secretIv: low!.secretIv,
      secretTag: low!.secretTag,
      keyId: low!.keyId,
    });
    await expect(v.get('high')).rejects.toThrow();
  });

  it('still reads legacy records sealed without aad', async () => {
    const adapter = new SqliteAdapter(':memory:');
    await adapter.init();
    const crypto = new Crypto({ key: generateKey() });
    const v = new Vault({ adapter, crypto });
    const legacy = await crypto.seal('legacy-secret'); // pre-upgrade: no aad
    await adapter.insert({
      id: globalThis.crypto.randomUUID(),
      namespace: 'default',
      name: 'old',
      description: null,
      tags: [],
      provider: null,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastAccessedAt: null,
      secretCiphertext: legacy.ciphertext,
      secretIv: legacy.iv,
      secretTag: legacy.tag,
      keyId: legacy.keyId,
    });
    expect(await v.get('old')).toBe('legacy-secret');
  });
});
