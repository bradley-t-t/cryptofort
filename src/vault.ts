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

  async put(input: CredentialInput): Promise<void> {
    const namespace = input.namespace ?? DEFAULT_NAMESPACE;
    const sealed = await this.crypto.seal(input.secret, this.aad(namespace, input.name));
    const now = new Date().toISOString();
    const existing = await this.adapter.findByName(namespace, input.name);
    if (existing) {
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
      await this.adapter.update(namespace, input.name, patch);
      return;
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

  async search(query: string, opts: SearchOptions = {}): Promise<CredentialMeta[]> {
    return this.adapter.searchMeta(query, opts);
  }

  async list(opts: ListOptions = {}): Promise<CredentialMeta[]> {
    return this.adapter.listMeta(opts);
  }

  async remove(name: string, opts: { namespace?: string } = {}): Promise<void> {
    await this.adapter.remove(opts.namespace ?? DEFAULT_NAMESPACE, name);
  }
}
