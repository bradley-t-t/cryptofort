import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '../src/mcp/server.js';
import { Vault } from '../src/vault.js';
import { Crypto, generateKey } from '../src/crypto.js';
import { SqliteAdapter } from '../src/adapters/sqlite.js';

async function makeVault() {
  const adapter = new SqliteAdapter(':memory:');
  await adapter.init();
  return new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
}

describe('mcp buildTools', () => {
  let vault: Vault;
  beforeEach(async () => {
    vault = await makeVault();
    await vault.put({ name: 'stripe-key', secret: 'sk_live_1', provider: 'stripe', tags: ['pay'] });
  });

  it('exposes metadata tools only by default', () => {
    const tools = buildTools(vault);
    expect(Object.keys(tools).sort()).toEqual(['credential_list', 'credential_search']);
  });

  it('withholds credential_get unless secret read is allowed', () => {
    expect(buildTools(vault, { allowWrite: true }).credential_get).toBeUndefined();
    expect(buildTools(vault, { allowSecretRead: true }).credential_get).toBeDefined();
  });

  it('adds the write tools when write is allowed', () => {
    const tools = buildTools(vault, { allowWrite: true });
    expect(Object.keys(tools)).toContain('credential_put');
    expect(Object.keys(tools)).toContain('credential_purge_expired');
  });

  it('withholds credential_delete from a server that may only write', () => {
    expect(buildTools(vault, { allowWrite: true }).credential_delete).toBeUndefined();
    expect(buildTools(vault, { allowDelete: true }).credential_delete).toBeDefined();
  });

  it('credential_delete removes the credential', async () => {
    const tools = buildTools(vault, { allowWrite: true, allowSecretRead: true, allowDelete: true });
    const res = await tools.credential_delete.handler({ name: 'stripe-key' });
    expect(res.content[0].text).toContain('deleted');
    expect(await vault.get('stripe-key')).toBeNull();
  });

  it('credential_delete reports a name that was never stored', async () => {
    const tools = buildTools(vault, { allowWrite: true, allowSecretRead: true, allowDelete: true });
    const res = await tools.credential_delete.handler({ name: 'nope' });
    expect(res.content[0].text.toLowerCase()).toContain('not found');
  });

  it('credential_search returns metadata without secrets', async () => {
    const tools = buildTools(vault);
    const res = await tools.credential_search.handler({ query: 'stripe' });
    const text = res.content[0].text;
    expect(text).toContain('stripe-key');
    expect(text).not.toContain('sk_live_1');
  });

  it('credential_get returns the decrypted secret', async () => {
    const tools = buildTools(vault, { allowSecretRead: true });
    const res = await tools.credential_get.handler({ name: 'stripe-key' });
    expect(res.content[0].text).toBe('sk_live_1');
  });

  it('credential_get reports when a credential is missing', async () => {
    const tools = buildTools(vault, { allowSecretRead: true });
    const res = await tools.credential_get.handler({ name: 'nope' });
    expect(res.content[0].text.toLowerCase()).toContain('not found');
  });

  it('credential_put stores an expiry and credential_get honors it', async () => {
    const tools = buildTools(vault, { allowWrite: true, allowSecretRead: true, allowDelete: true });
    const past = new Date(Date.now() - 60_000).toISOString();
    await tools.credential_put.handler({ name: 'temp', secret: 's3cret', expiresAt: past });
    const res = await tools.credential_get.handler({ name: 'temp' });
    expect(res.content[0].text.toLowerCase()).toContain('not found');
  });

  it('credential_purge_expired deletes entries whose time has come up', async () => {
    const tools = buildTools(vault, { allowWrite: true, allowSecretRead: true, allowDelete: true });
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    await tools.credential_put.handler({ name: 'dead', secret: 'a', expiresAt: past });
    await tools.credential_put.handler({ name: 'live', secret: 'b', expiresAt: future });
    const res = await tools.credential_purge_expired.handler({});
    expect(res.content[0].text).toBe('purged: 1 expired credential');
    expect(await vault.get('live')).toBe('b');
  });
});
