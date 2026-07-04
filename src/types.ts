/** The encrypted secret payload, all values base64. */
export interface SealedSecret {
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
  keyId: string;
}

/** Non-secret, searchable fields returned by search/list. */
export interface CredentialMeta {
  id: string;
  namespace: string;
  name: string;
  description: string | null;
  tags: string[];
  provider: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
}

/** A full persisted row: metadata + sealed secret. */
export interface SealedRecord extends CredentialMeta, SealedSecret {}

/** Caller input for creating/updating a credential. */
export interface CredentialInput {
  name: string;
  secret: string;
  description?: string;
  tags?: string[];
  provider?: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  tags?: string[];
  namespace?: string;
  limit?: number;
}

export interface ListOptions {
  tags?: string[];
  namespace?: string;
}

export const DEFAULT_NAMESPACE = 'default';
