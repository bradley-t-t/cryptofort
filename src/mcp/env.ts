/**
 * The boundary where pasted text becomes CryptoFort's configuration.
 *
 * Environment values are typed or pasted by an operator into a shell profile, a
 * `.env` file, or a hosting provider's variable settings, and several of them —
 * the Supabase URL and its service key above all — are handed to an HTTP client
 * that writes them verbatim into request headers. A header value is a
 * ByteString: every character has to fit in a single byte, so one character
 * above U+00FF makes the request unconstructable and `fetch` throws before
 * anything reaches the network. That throw names an index into a string it does
 * not show, arrives from inside the HTTP client rather than from any CryptoFort
 * frame, and repeats on every operation, so a misconfigured vault presents as a
 * broken one.
 *
 * A secret shown masked carries exactly such a character. A UI that reveals a
 * key's first characters and substitutes U+2022 for the rest yields, when its
 * display is copied instead of its value, something shaped like a credential
 * that cannot be sent as one.
 *
 * Values are therefore checked as they enter the process rather than where they
 * break. A credential, URL, or identifier that is not printable ASCII is refused
 * by name, with the offending character and its position, which is the whole
 * class rather than one character: mask glyphs, smart quotes, non-breaking
 * spaces, accented letters, emoji, and the carriage return that would split a
 * request in two.
 */

/**
 * How strictly one variable's value is constrained.
 *
 * `token` covers credentials, URLs, and identifiers: anything that can reach an
 * HTTP header, a connection string, or a record CryptoFort stamps. `path` covers
 * filesystem locations, where a space or an accented directory name is ordinary
 * and no header is involved.
 */
export type EnvValueKind = 'token' | 'path';

/** Thrown when a variable holds a value CryptoFort cannot use as configured. */
export class EnvValueError extends Error {
  /** The variable whose value was refused. */
  readonly variable: string;

  constructor(variable: string, message: string) {
    super(message);
    this.name = 'EnvValueError';
    this.variable = variable;
  }
}

// The byte-order mark and the zero-width family: characters that render as
// nothing, survive a copy, and turn an otherwise correct key into a wrong one.
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

// Glyphs a UI substitutes for the part of a secret it will not display. Their
// presence identifies a masked value, which needs a different remedy from a
// stray character: the value is not the credential at all.
const MASK_GLYPHS = new Set(['•', '·', '∙', '●', '○', '▪', '⁃']);

const MIN_PRINTABLE = 0x21;
const MAX_PRINTABLE = 0x7e;

function codePointName(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Strip the noise a value picks up between its source and `process.env`.
 *
 * Leading and trailing whitespace, a trailing newline from a heredoc, a matched
 * pair of quotes from a `.env` file, and invisible characters from a copy all
 * change the value without being visible in it. None of them can be meant, so
 * removing them is not a guess about intent.
 */
export function sanitizeEnvValue(raw: string): string {
  let value = raw.replace(INVISIBLE, '').trim();
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

/**
 * Refuse a value that cannot be carried in an HTTP header or a connection
 * string, naming the character and where it sits.
 *
 * Printable ASCII is the accepted range. Everything a credential legitimately
 * contains falls inside it, and everything outside it is either impossible to
 * encode, silently re-encoded into something the far end will not recognize, or
 * a control character that would break the request framing.
 *
 * @throws EnvValueError when any character falls outside U+0021 to U+007E.
 */
export function assertHeaderSafe(variable: string, value: string): void {
  // The index counts UTF-16 units, matching the position fetch reports for the
  // same string, while the code point is read whole so an astral character is
  // named as itself rather than as its leading surrogate.
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i) as number;
    if (code >= MIN_PRINTABLE && code <= MAX_PRINTABLE) continue;
    if (MASK_GLYPHS.has(String.fromCodePoint(code))) {
      throw new EnvValueError(
        variable,
        `cryptofort: ${variable} holds a masked value, not a credential: ${codePointName(code)} ` +
          `at index ${i} is the character a display substitutes for the part of a secret it hides. ` +
          `Copy the value itself from its source rather than the masked display, and set it again.`,
      );
    }
    throw new EnvValueError(
      variable,
      `cryptofort: ${variable} contains ${codePointName(code)} at index ${i}, which cannot be ` +
        `sent in an HTTP header or a connection string. Only printable ASCII (U+0021 to U+007E) ` +
        `is accepted; check the value for a line break, a non-breaking space, a smart quote, or ` +
        `another character introduced by the paste.`,
    );
  }
}

/**
 * Read one environment variable, sanitized and checked for its kind.
 *
 * @returns the cleaned value, or undefined when the variable is unset or holds
 *   nothing but the noise `sanitizeEnvValue` removes.
 * @throws EnvValueError when a `token` value is not printable ASCII.
 */
export function readEnv(variable: string, kind: EnvValueKind = 'token'): string | undefined {
  const raw = process.env[variable];
  if (raw === undefined) return undefined;
  const value = sanitizeEnvValue(raw);
  if (value === '') return undefined;
  if (kind === 'token') assertHeaderSafe(variable, value);
  return value;
}

/**
 * Read one environment variable that the server cannot start without.
 *
 * @throws Error when the variable is unset or empty.
 * @throws EnvValueError when a `token` value is not printable ASCII.
 */
export function requireEnv(variable: string, kind: EnvValueKind = 'token'): string {
  const value = readEnv(variable, kind);
  if (value === undefined) throw new Error(`cryptofort: ${variable} is required`);
  return value;
}
