import { describe, it, expect } from 'vitest';
import { Crypto, generateKey } from '../src/crypto.js';

const key = generateKey(); // base64 32 bytes

describe('Crypto', () => {
  it('round-trips plaintext', async () => {
    const c = new Crypto({ key });
    const sealed = await c.seal('super-secret-token');
    expect(sealed.ciphertext).not.toContain('super-secret-token');
    const opened = await c.open(sealed);
    expect(opened).toBe('super-secret-token');
  });

  it('produces a distinct IV each call', async () => {
    const c = new Crypto({ key });
    const a = await c.seal('x');
    const b = await c.seal('x');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to open a tampered ciphertext', async () => {
    const c = new Crypto({ key });
    const sealed = await c.seal('x');
    const bad = { ...sealed, tag: Buffer.from('0'.repeat(16)).toString('base64') };
    await expect(c.open(bad)).rejects.toThrow();
  });

  it('fails to open with the wrong key', async () => {
    const sealed = await new Crypto({ key }).seal('x');
    const other = new Crypto({ key: generateKey() });
    await expect(other.open(sealed)).rejects.toThrow();
  });

  it('stamps the active keyId and opens older keys by id', async () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const oldSealed = await new Crypto({ key: oldKey, keyId: 'v1' }).seal('x');
    const c = new Crypto({ key: newKey, keyId: 'v2', keys: { v1: oldKey, v2: newKey } });
    expect((await c.seal('y')).keyId).toBe('v2');
    expect(await c.open(oldSealed)).toBe('x'); // opened via keys['v1']
  });
});
