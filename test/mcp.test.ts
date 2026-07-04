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

  it('exposes read tools only by default', () => {
    const tools = buildTools(vault, false);
    expect(Object.keys(tools).sort()).toEqual([
      'credential_get',
      'credential_list',
      'credential_search',
    ]);
  });

  it('adds credential_put when write is allowed', () => {
    const tools = buildTools(vault, true);
    expect(Object.keys(tools)).toContain('credential_put');
  });

  it('credential_search returns metadata without secrets', async () => {
    const tools = buildTools(vault, false);
    const res = await tools.credential_search.handler({ query: 'stripe' });
    const text = res.content[0].text;
    expect(text).toContain('stripe-key');
    expect(text).not.toContain('sk_live_1');
  });

  it('credential_get returns the decrypted secret', async () => {
    const tools = buildTools(vault, false);
    const res = await tools.credential_get.handler({ name: 'stripe-key' });
    expect(res.content[0].text).toBe('sk_live_1');
  });

  it('credential_get reports when a credential is missing', async () => {
    const tools = buildTools(vault, false);
    const res = await tools.credential_get.handler({ name: 'nope' });
    expect(res.content[0].text.toLowerCase()).toContain('not found');
  });
});
