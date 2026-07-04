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

  async put(input: CredentialInput): Promise<void> {
    const namespace = input.namespace ?? DEFAULT_NAMESPACE;
    const sealed = await this.crypto.seal(input.secret);
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
    const secret = await this.crypto.open({
      ciphertext: record.secretCiphertext,
      iv: record.secretIv,
      tag: record.secretTag,
      keyId: record.keyId,
    });
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
