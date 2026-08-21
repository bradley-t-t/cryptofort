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
    expect(await vault.remove('k')).toBe(true);
    expect(await vault.get('k')).toBeNull();
  });

  it('remove reports a name that was never stored', async () => {
    expect(await vault.remove('absent')).toBe(false);
  });

  it('remove leaves the same name in another namespace alone', async () => {
    await vault.put({ name: 'k', secret: 'mine' });
    await vault.put({ name: 'k', secret: 'theirs', namespace: 'other' });
    await vault.remove('k');
    expect(await vault.get('k')).toBeNull();
    expect(await vault.get('k', { namespace: 'other' })).toBe('theirs');
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
    const legacy = await crypto.seal('legacy-secret');
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
      expiresAt: null,
      secretCiphertext: legacy.ciphertext,
      secretIv: legacy.iv,
      secretTag: legacy.tag,
      keyId: legacy.keyId,
    });
    expect(await v.get('old')).toBe('legacy-secret');
  });
});

describe('Vault expiry', () => {
  let vault: Vault;
  beforeEach(async () => {
    vault = await makeVault();
  });

  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();

  it('get returns an unexpired credential and its expiry in metadata', async () => {
    await vault.put({ name: 'k', secret: 'v', expiresAt: future });
    expect(await vault.get('k')).toBe('v');
    const [meta] = await vault.search('k');
    expect(meta.expiresAt).toBe(future);
  });

  it('get deletes an expired credential and returns null', async () => {
    const adapter = new SqliteAdapter(':memory:');
    await adapter.init();
    const v = new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
    await v.put({ name: 'k', secret: 'v', expiresAt: past });
    expect(await v.get('k')).toBeNull();
    // Gone from the store itself, not just filtered from the response.
    expect(await adapter.findByName('default', 'k')).toBeNull();
  });

  it('search and list hide expired credentials before any purge runs', async () => {
    await vault.put({ name: 'live', secret: 'a', expiresAt: future });
    await vault.put({ name: 'dead', secret: 'b', expiresAt: past });
    expect((await vault.search('')).map((m) => m.name)).toEqual(['live']);
    expect((await vault.list()).map((m) => m.name)).toEqual(['live']);
  });

  it('purgeExpired deletes only entries whose time has come up', async () => {
    await vault.put({ name: 'live', secret: 'a', expiresAt: future });
    await vault.put({ name: 'dead-1', secret: 'b', expiresAt: past });
    await vault.put({ name: 'dead-2', secret: 'c', namespace: 'other', expiresAt: past });
    await vault.put({ name: 'forever', secret: 'd' });
    expect(await vault.purgeExpired()).toBe(2);
    expect(await vault.get('live')).toBe('a');
    expect(await vault.get('forever')).toBe('d');
    expect(await vault.get('dead-1')).toBeNull();
    expect(await vault.get('dead-2', { namespace: 'other' })).toBeNull();
  });

  it('purgeExpired reports zero when nothing has expired', async () => {
    await vault.put({ name: 'k', secret: 'v', expiresAt: future });
    expect(await vault.purgeExpired()).toBe(0);
  });

  it('put normalizes the expiry to canonical UTC', async () => {
    await vault.put({ name: 'k', secret: 'v', expiresAt: '2099-01-01T12:00:00+02:00' });
    const [meta] = await vault.search('k');
    expect(meta.expiresAt).toBe('2099-01-01T10:00:00.000Z');
  });

  it('put rejects an unparseable expiry', async () => {
    await expect(vault.put({ name: 'k', secret: 'v', expiresAt: 'someday' })).rejects.toThrow(
      /invalid expiresAt/,
    );
  });

  it('put over an expired credential starts fresh instead of inheriting the stale expiry', async () => {
    await vault.put({ name: 'k', secret: 'old', expiresAt: past });
    await vault.put({ name: 'k', secret: 'new' });
    expect(await vault.get('k')).toBe('new');
    const [meta] = await vault.search('k');
    expect(meta.expiresAt).toBeNull();
  });

  it('upsert can set, keep, and clear an expiry', async () => {
    await vault.put({ name: 'k', secret: 'v1', expiresAt: future });
    await vault.put({ name: 'k', secret: 'v2' }); // omitted -> unchanged
    let [meta] = await vault.search('k');
    expect(meta.expiresAt).toBe(future);
    await vault.put({ name: 'k', secret: 'v3', expiresAt: null }); // null -> cleared
    [meta] = await vault.search('k');
    expect(meta.expiresAt).toBeNull();
  });
});
