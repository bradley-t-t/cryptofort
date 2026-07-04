export interface Sealed {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  tag: string; // base64 (16 bytes)
  keyId: string;
}

export interface CryptoOptions {
  /** base64-encoded 32-byte active key */
  key: string;
  /** identifier stamped on newly sealed records; default 'default' */
  keyId?: string;
  /** optional map of keyId -> base64 key, for opening records sealed under old keys */
  keys?: Record<string, string>;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Generate a fresh base64 32-byte key. */
export function generateKey(): string {
  const raw = new Uint8Array(32);
  globalThis.crypto.getRandomValues(raw);
  return Buffer.from(raw).toString('base64');
}

function decodeKey(b64: string): Uint8Array {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) {
    throw new Error(`cryptofort: master key must decode to 32 bytes, got ${raw.length}`);
  }
  return new Uint8Array(raw);
}

// Web Crypto wants an ArrayBuffer-backed BufferSource; Node Buffers and the
// generic Uint8Array<ArrayBufferLike> don't satisfy that type. Copy into a
// standalone ArrayBuffer so the subtle calls typecheck across TS lib versions.
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(u.byteLength);
  new Uint8Array(copy).set(u);
  return copy;
}

export class Crypto {
  private readonly activeKeyId: string;
  private readonly keys: Record<string, Uint8Array>;

  constructor(opts: CryptoOptions) {
    this.activeKeyId = opts.keyId ?? 'default';
    this.keys = {};
    const provided = opts.keys ?? { [this.activeKeyId]: opts.key };
    for (const [id, k] of Object.entries(provided)) this.keys[id] = decodeKey(k);
    // Ensure the active key is present even if `keys` was passed without it.
    if (!this.keys[this.activeKeyId]) this.keys[this.activeKeyId] = decodeKey(opts.key);
  }

  private async importKey(raw: Uint8Array): Promise<CryptoKey> {
    return globalThis.crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  }

  async seal(plaintext: string): Promise<Sealed> {
    const iv = new Uint8Array(IV_BYTES);
    globalThis.crypto.getRandomValues(iv);
    const key = await this.importKey(this.keys[this.activeKeyId]);
    const out = new Uint8Array(
      await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: TAG_BYTES * 8 },
        key,
        toArrayBuffer(new TextEncoder().encode(plaintext)),
      ),
    );
    // Web Crypto appends the GCM tag to the ciphertext; split for separate columns.
    const ct = out.slice(0, out.length - TAG_BYTES);
    const tag = out.slice(out.length - TAG_BYTES);
    return {
      ciphertext: Buffer.from(ct).toString('base64'),
      iv: Buffer.from(iv).toString('base64'),
      tag: Buffer.from(tag).toString('base64'),
      keyId: this.activeKeyId,
    };
  }

  async open(sealed: Sealed): Promise<string> {
    const raw = this.keys[sealed.keyId];
    if (!raw) throw new Error(`cryptofort: no key available for keyId '${sealed.keyId}'`);
    const key = await this.importKey(raw);
    const ct = Buffer.from(sealed.ciphertext, 'base64');
    const tag = Buffer.from(sealed.tag, 'base64');
    const iv = new Uint8Array(Buffer.from(sealed.iv, 'base64'));
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv), tagLength: TAG_BYTES * 8 },
      key,
      toArrayBuffer(combined),
    );
    return new TextDecoder().decode(plain);
  }
}
