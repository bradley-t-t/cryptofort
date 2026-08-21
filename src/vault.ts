import { Crypto } from './crypto.js';
import type { CredentialStore } from './adapters/types.js';
import {
  DEFAULT_NAMESPACE,
  type CredentialInput,
  type CredentialMeta,
  type ListOptions,
  type SealedRecord,
  type SearchOptions,
} from './types.js';

export interface VaultOptions {
  adapter: CredentialStore;
  crypto: Crypto;
}

export class Vault {
  private readonly adapter: CredentialStore;
  private readonly crypto: Crypto;

  constructor(opts: VaultOptions) {
    this.adapter = opts.adapter;
    this.crypto = opts.crypto;
  }

  // Bind each sealed secret to its namespace+name so a ciphertext cannot be
  // moved to another record (or namespace) without failing the GCM tag check.
  // The NUL separator keeps the pair unambiguous across identifier values.
  private aad(namespace: string, name: string): string {
    return `${namespace}\u0000${name}`;
  }

  // Store expiries in the same canonical UTC format as the other timestamps,
  // whatever offset or format the caller passed: SQLite compares the column as
  // text, so purge correctness depends on every value sorting chronologically.
  private normalizeExpiry(value: string): string {
    const t = Date.parse(value);
    if (Number.isNaN(t)) {
      throw new Error(`cryptofort: invalid expiresAt timestamp: ${value}`);
    }
    return new Date(t).toISOString();
  }

  private isExpired(meta: CredentialMeta): boolean {
    return meta.expiresAt !== null && Date.parse(meta.expiresAt) <= Date.now();
  }

  async put(input: CredentialInput): Promise<void> {
    const namespace = input.namespace ?? DEFAULT_NAMESPACE;
    const sealed = await this.crypto.seal(input.secret, this.aad(namespace, input.name));
    const now = new Date().toISOString();
    const expiresAt = input.expiresAt == null ? null : this.normalizeExpiry(input.expiresAt);
    const existing = await this.adapter.findByName(namespace, input.name);
    if (existing) {
      if (this.isExpired(existing)) {
        // The old record's time already came up, so it must not leak anything
        // into its successor: replace it wholesale rather than let a stale
        // expiry (or description, tags, …) ride along and kill the new secret.
        await this.adapter.remove(namespace, input.name);
      } else {
        const patch: Partial<SealedRecord> = {
          secretCiphertext: sealed.ciphertext,
          secretIv: sealed.iv,
          secretTag: sealed.tag,
          keyId: sealed.keyId,
          updatedAt: now,
        };
        if (input.description !== undefined) patch.description = input.description;
        if (input.tags !== undefined) patch.tags = input.tags;
        if (input.provider !== undefined) patch.provider = input.provider;
        if (input.metadata !== undefined) patch.metadata = input.metadata;
        if (input.expiresAt !== undefined) patch.expiresAt = expiresAt;
        await this.adapter.update(namespace, input.name, patch);
        return;
      }
    }
    const record: SealedRecord = {
      id: globalThis.crypto.randomUUID(),
      namespace,
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
      provider: input.provider ?? null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: null,
      expiresAt,
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      secretTag: sealed.tag,
      keyId: sealed.keyId,
    };
    await this.adapter.insert(record);
  }

  async get(name: string, opts: { namespace?: string } = {}): Promise<string | null> {
    const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
    const record = await this.adapter.findByName(namespace, name);
    if (!record) return null;
    if (this.isExpired(record)) {
      // The expiry has passed, so this read is the moment the record dies:
      // delete it now rather than hand out a secret that a purge merely
      // hasn't reached yet.
      await this.adapter.remove(namespace, name);
      return null;
    }
    const sealed = {
      ciphertext: record.secretCiphertext,
      iv: record.secretIv,
      tag: record.secretTag,
      keyId: record.keyId,
    };
    let secret: string;
    try {
      secret = await this.crypto.open(sealed, this.aad(namespace, name));
    } catch {
      // Records written before AAD binding was introduced were sealed without
      // it; fall back so existing secrets stay readable. They pick up the
      // binding the next time they are put(). A genuinely tampered or swapped
      // record fails this second open too, so the error still propagates.
      secret = await this.crypto.open(sealed);
    }
    await this.adapter.touchAccessed(namespace, name);
    return secret;
  }

  // search/list drop expired rows that no purge has reached yet, so an expiry
  // takes effect the instant it passes even though the delete itself is lazy.
  async search(query: string, opts: SearchOptions = {}): Promise<CredentialMeta[]> {
    const hits = await this.adapter.searchMeta(query, opts);
    return hits.filter((m) => !this.isExpired(m));
  }

  async list(opts: ListOptions = {}): Promise<CredentialMeta[]> {
    const list = await this.adapter.listMeta(opts);
    return list.filter((m) => !this.isExpired(m));
  }

  /** Delete every credential whose expiry has passed. Returns how many were deleted. */
  async purgeExpired(): Promise<number> {
    return this.adapter.removeExpired(new Date().toISOString());
  }

  // Answers whether a record was actually there, because deleting is the one
  // operation with nothing to check afterwards: a mistyped name removes nothing
  // and looks exactly like a removal that worked.
  async remove(name: string, opts: { namespace?: string } = {}): Promise<boolean> {
    const namespace = opts.namespace ?? DEFAULT_NAMESPACE;
    const existing = await this.adapter.findByName(namespace, name);
    if (!existing) {
      return false;
    }
    await this.adapter.remove(namespace, name);
    return true;
  }
}
