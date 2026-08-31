import { describe, it, expect, afterEach } from 'vitest';
import {
  EnvValueError,
  assertHeaderSafe,
  readEnv,
  requireEnv,
  sanitizeEnvValue,
} from '../src/mcp/env.js';

const VAR = 'CRYPTOFORT_TEST_VALUE';

// A JSON Web Token opens with its header object encoded as base64url, and every
// Supabase key uses the same algorithm, so the first eight characters are the
// same for all of them. A display that reveals those and masks the rest puts its
// first bullet at index 8 of whatever header carries the key, which is the
// position the failure below is pinned to. Deriving the prefix rather than
// quoting it keeps the eight from being a number nobody can check.
const TOKEN_PREFIX = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url').slice(0, 8);
const BULLET = '•';
const MASKED_KEY = TOKEN_PREFIX + BULLET.repeat(30);

function setEnv(value: string): void {
  process.env[VAR] = value;
}

afterEach(() => {
  delete process.env[VAR];
});

describe('sanitizeEnvValue', () => {
  it('drops surrounding whitespace and a trailing newline', () => {
    expect(sanitizeEnvValue('  value-1\n')).toBe('value-1');
  });

  it('drops a matched pair of quotes left by a .env file', () => {
    expect(sanitizeEnvValue('"value-1"')).toBe('value-1');
    expect(sanitizeEnvValue("'value-1'")).toBe('value-1');
  });

  it('keeps quotes that are part of the value rather than around it', () => {
    expect(sanitizeEnvValue('"value-1')).toBe('"value-1');
    expect(sanitizeEnvValue('va"lu"e-1')).toBe('va"lu"e-1');
  });

  it('drops invisible characters that survive a copy', () => {
    expect(sanitizeEnvValue('\uFEFFval\u200Bue-1')).toBe('value-1');
  });
});

describe('assertHeaderSafe', () => {
  it('accepts the shapes a credential actually takes', () => {
    for (const value of [
      `${TOKEN_PREFIX}aBc123-_xyz`,
      `${TOKEN_PREFIX}.aBc123.dEf456`,
      'https://project-ref.supabase.co',
      'postgresql://reader@db.example.co:5432/postgres?sslmode=require',
      Buffer.alloc(32, 7).toString('base64'),
    ]) {
      expect(() => assertHeaderSafe(VAR, value)).not.toThrow();
    }
  });

  it('refuses every character that cannot be a header byte', () => {
    for (const value of [
      `value${BULLET}`, // mask glyph
      'value—1', // em dash
      'value’s', // smart quote
      'value\u00A01', // non-breaking space
      'valué-1', // latin-1 but not ASCII
      'value🔑', // astral: a key emoji
      'value\r\nX-Injected: 1', // request splitting
      'value 1', // interior space
    ]) {
      expect(() => assertHeaderSafe(VAR, value)).toThrow(EnvValueError);
    }
  });

  it('names the variable, the character, and where it sits', () => {
    expect(() => assertHeaderSafe('SUPABASE_SERVICE_ROLE_KEY', MASKED_KEY)).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY.*U\+2022.*index 8/s,
    );
  });

  it('tells a masked value apart from a stray character', () => {
    expect(() => assertHeaderSafe(VAR, MASKED_KEY)).toThrow(/masked/);
    expect(() => assertHeaderSafe(VAR, 'value—1')).not.toThrow(/masked/);
  });

  it('reports an astral character as itself rather than as its surrogate', () => {
    expect(() => assertHeaderSafe(VAR, 'value🔑')).toThrow(/U\+1F511/);
  });
});

describe('readEnv', () => {
  it('returns the sanitized value', () => {
    setEnv('  "value-1"  ');
    expect(readEnv(VAR)).toBe('value-1');
  });

  it('treats unset and whitespace-only alike', () => {
    expect(readEnv(VAR)).toBeUndefined();
    setEnv('   ');
    expect(readEnv(VAR)).toBeUndefined();
  });

  it('refuses a token that cannot be sent', () => {
    setEnv(MASKED_KEY);
    expect(() => readEnv(VAR)).toThrow(EnvValueError);
  });

  it('keeps a filesystem path whole', () => {
    setEnv('/Users/someone/My Vaults/café/cryptofort.db');
    expect(readEnv(VAR, 'path')).toBe('/Users/someone/My Vaults/café/cryptofort.db');
  });
});

describe('requireEnv', () => {
  it('reports an unset variable by name', () => {
    expect(() => requireEnv(VAR)).toThrow(`cryptofort: ${VAR} is required`);
  });

  it('returns the value when it is set', () => {
    setEnv('value-1');
    expect(requireEnv(VAR)).toBe('value-1');
  });
});

// The vault reached Supabase with a service-role key holding U+2022 where a
// display had masked it. supabase-js writes that key into the apikey and
// Authorization headers verbatim, a header value has to be a ByteString, and so
// every vault call died inside the HTTP client with "Cannot convert argument to
// a ByteString because the character at index 8 has a value of 8226". No
// CryptoFort frame appeared in that message and nothing in it named the variable
// at fault.
describe('a masked credential cannot reach a request header', () => {
  it('is refused before anything tries to build a header from it', () => {
    expect(() => new Headers({ apikey: MASKED_KEY })).toThrow(/index 8.*8226/);
    expect(() => assertHeaderSafe('SUPABASE_SERVICE_ROLE_KEY', MASKED_KEY)).toThrow(EnvValueError);
  });

  // The guarantee is about the accepted range rather than about one character:
  // anything readEnv returns for a token can be built into a header, so no value
  // it passes can reproduce the failure.
  it('accepts nothing that a header cannot carry', () => {
    const hostile = [
      MASKED_KEY,
      `value${BULLET}${BULLET}`,
      'value—dash',
      'value nbsp',
      'value\uFEFFbom',
      'value🔑',
      'valué',
      'value-ok',
      '  "value-quoted"  ',
      'value\r\nX-Injected: 1',
    ];
    const accepted: string[] = [];
    for (const value of hostile) {
      setEnv(value);
      let passed: string | undefined;
      try {
        passed = readEnv(VAR);
      } catch (err) {
        expect(err).toBeInstanceOf(EnvValueError);
        continue;
      }
      accepted.push(passed as string);
      expect(() => new Headers({ apikey: passed as string })).not.toThrow();
    }
    // Refusing everything would satisfy the invariant while breaking the vault,
    // so the values carrying nothing worse than strippable noise have to be
    // among what got through.
    expect(accepted).toEqual(['valuebom', 'value-ok', 'value-quoted']);
  });
});
