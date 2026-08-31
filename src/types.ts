/** The encrypted secret payload. Ciphertext, IV and tag are base64; keyId names the key that sealed it. */
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
  /** When set, the credential is deleted once this instant passes. */
  expiresAt: string | null;
}

export interface SealedRecord extends CredentialMeta, SealedSecret {}

export interface CredentialInput {
  name: string;
  secret: string;
  description?: string;
  tags?: string[];
  provider?: string;
  namespace?: string;
  metadata?: Record<string, unknown>;
  /** ISO 8601 timestamp after which the credential is deleted; null clears an existing expiry. */
  expiresAt?: string | null;
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
