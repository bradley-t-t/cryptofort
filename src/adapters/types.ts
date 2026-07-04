import type { CredentialMeta, ListOptions, SealedRecord, SearchOptions } from '../types.js';

/** Persistence contract. Implementations treat the sealed secret as opaque. */
export interface CredentialStore {
  /** Create the table/schema if it does not exist. Idempotent. */
  init(): Promise<void>;
  insert(row: SealedRecord): Promise<void>;
  update(namespace: string, name: string, patch: Partial<SealedRecord>): Promise<void>;
  findByName(namespace: string, name: string): Promise<SealedRecord | null>;
  searchMeta(query: string, opts: SearchOptions): Promise<CredentialMeta[]>;
  listMeta(opts: ListOptions): Promise<CredentialMeta[]>;
  remove(namespace: string, name: string): Promise<void>;
  touchAccessed(namespace: string, name: string): Promise<void>;
}
