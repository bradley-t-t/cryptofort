import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { Vault } from '../vault.js';
import { DEFAULT_NAMESPACE } from '../types.js';

/** One credential to hand the command, and the variable the command reads it from. */
export interface CredentialMapping {
  name: string;
  variable: string;
}

/** A parsed `cryptofort run` command line. */
export interface RunPlan {
  namespace: string;
  /** A file holding the vault's own configuration, read before the vault is opened. */
  envFile?: string;
  mappings: CredentialMapping[];
  command: string[];
}

export const RUN_USAGE = `usage: cryptofort run [--namespace <ns>] [--env-file <path>] <credential>[=<ENV_VAR>]... -- <command> [args...]

Runs <command> with each named credential decrypted into its environment, so the
value never appears on a command line, in shell history, or in the output of the
process that asked for it. It cannot stop the command itself printing it. A
credential given without =<ENV_VAR> is read from its own name in upper case, with
every run of other characters turned into an underscore: stripe-secret-key
becomes STRIPE_SECRET_KEY.

The vault is configured by the same environment variables as cryptofort-mcp,
taken from this process's environment or from --env-file, a NAME=value file only
its owner can read. The command inherits neither: it gets the credentials it was
named and nothing that would let it open the vault itself.`;

/** A command line that cannot be run as written. The message is the whole report. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** One or more named credentials the vault does not hold, so nothing was run. */
export class MissingCredentialError extends Error {
  readonly names: string[];
  readonly namespace: string;

  constructor(names: string[], namespace: string) {
    const list = names.map((n) => `'${n}'`).join(', ');
    super(
      `cryptofort run: the vault holds no ${list} in namespace '${namespace}', or it has ` +
        `expired, so nothing was run`,
    );
    this.name = 'MissingCredentialError';
    this.names = names;
    this.namespace = namespace;
  }
}

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The variable a credential is read from when the command line names none. */
export function variableFor(name: string): string {
  const variable = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(variable) ? `_${variable}` : variable;
}

/** Parse the arguments that follow `cryptofort run`. */
export function parseRunArgs(args: string[]): RunPlan {
  const split = args.indexOf('--');
  if (split === -1) {
    throw new UsageError('cryptofort run: put -- between the credentials and the command');
  }
  const command = args.slice(split + 1);
  if (command.length === 0) throw new UsageError('cryptofort run: nothing to run after --');

  let namespace = DEFAULT_NAMESPACE;
  let envFile: string | undefined;
  const mappings: CredentialMapping[] = [];
  const before = args.slice(0, split);
  for (let i = 0; i < before.length; i++) {
    const arg = before[i];
    // An option's value is the next argument, or follows `=` in the same one.
    const option = (long: string, short?: string): string | undefined => {
      if (arg.startsWith(`${long}=`)) return arg.slice(long.length + 1) || missingValue(long);
      if (arg !== long && arg !== short) return undefined;
      const value = before[++i];
      return value && !value.startsWith('-') ? value : missingValue(long);
    };
    const ns = option('--namespace', '-n');
    if (ns !== undefined) {
      namespace = ns;
      continue;
    }
    const file = option('--env-file');
    if (file !== undefined) {
      envFile = file;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`cryptofort run: unknown option ${arg}`);
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const variable = eq === -1 ? variableFor(arg) : arg.slice(eq + 1);
    if (!name) throw new UsageError(`cryptofort run: '${arg}' names no credential`);
    if (!VARIABLE.test(variable)) {
      throw new UsageError(
        `cryptofort run: '${variable}' is not an environment variable name (from '${arg}')`,
      );
    }
    // Two credentials into one variable would leave the command reading
    // whichever came last, which is a guess the command line did not make.
    if (mappings.some((m) => m.variable === variable)) {
      throw new UsageError(`cryptofort run: ${variable} is given more than one credential`);
    }
    mappings.push({ name, variable });
  }
  if (mappings.length === 0) {
    throw new UsageError('cryptofort run: name at least one credential before --');
  }
  return envFile === undefined
    ? { namespace, mappings, command }
    : { namespace, envFile, mappings, command };
}

function missingValue(option: string): never {
  throw new UsageError(`cryptofort run: ${option} needs a value`);
}

/**
 * Read the vault's configuration from a `NAME=value` file into this process's
 * environment.
 *
 * The file holds the master key, so a copy another user can read is refused
 * rather than used: a key that has been readable by others has to be treated as
 * read. Its values go into this process only; `childEnv` is given the
 * environment from before the file was read, so nothing in it reaches the
 * command.
 *
 * A leading `~/` is read as the home directory, because a shell leaves it alone
 * in `--env-file=~/…`, where it does not start a word.
 *
 * @throws Error when the file is missing, or readable by its group or others.
 */
export function loadEnvFile(given: string, target: NodeJS.ProcessEnv = process.env): void {
  const path = given.startsWith('~/') ? join(homedir(), given.slice(2)) : given;
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    throw new Error(`cryptofort run: no env file at ${path}`);
  }
  if (process.platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new Error(
      `cryptofort run: ${path} can be read by other users; chmod 600 it, and treat the key ` +
        `in it as exposed if anyone else could have read it`,
    );
  }
  Object.assign(target, parseEnv(readFileSync(path, 'utf8')));
}

/**
 * Decrypt every credential the plan names, keyed by the variable it goes into.
 *
 * All or nothing: a command started without one of the values it was promised
 * fails later and further from the cause, or quietly falls back to a default
 * such as a local database, so a missing credential stops the run before the
 * command starts and names every one that was absent.
 *
 * @throws MissingCredentialError when any named credential is absent or expired.
 */
export async function resolveCredentials(
  vault: Vault,
  plan: RunPlan,
): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};
  const missing: string[] = [];
  for (const { name, variable } of plan.mappings) {
    const secret = await vault.get(name, { namespace: plan.namespace });
    if (secret === null) missing.push(name);
    else secrets[variable] = secret;
  }
  if (missing.length > 0) throw new MissingCredentialError(missing, plan.namespace);
  return secrets;
}

/**
 * The environment the command runs with: this process's own, without the
 * variables that open the vault, plus the credentials it was named.
 *
 * Every `CRYPTOFORT_*` variable configures the vault, and the Supabase
 * service-role key is full access to the table the vault lives in. A command
 * that inherited them could read every other credential, so it does not. A
 * credential mapped onto one of those names on purpose is still set, because
 * the named credentials are applied last.
 */
export function childEnv(
  base: NodeJS.ProcessEnv,
  secrets: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith('CRYPTOFORT_') || key === 'SUPABASE_SERVICE_ROLE_KEY') continue;
    env[key] = value;
  }
  return { ...env, ...secrets };
}

/** How the command ended: an exit code, or the signal that stopped it. */
export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

// A terminal delivers Ctrl-C and Ctrl-\ to the whole foreground process group,
// so the command already has them; forwarding would deliver each one twice, and
// a second interrupt means "stop now" to many programs. They are only held off
// here, so this process outlives the command and reports how it ended. A
// termination aimed at this process alone is passed on, or the command would be
// orphaned with the credentials still in its environment.
const HELD = ['SIGINT', 'SIGQUIT'] as const;
const FORWARDED = ['SIGTERM', 'SIGHUP'] as const;

/**
 * Run the command with the given environment, sharing this process's stdio.
 *
 * @throws the spawn error (ENOENT, EACCES, …) when the command cannot start.
 */
export function runCommand(command: string[], env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env });
    const hold = (): void => {};
    const forward = (signal: NodeJS.Signals) => (): void => {
      child.kill(signal);
    };
    const handlers: [NodeJS.Signals, () => void][] = [
      ...HELD.map((s): [NodeJS.Signals, () => void] => [s, hold]),
      ...FORWARDED.map((s): [NodeJS.Signals, () => void] => [s, forward(s)]),
    ];
    for (const [signal, handler] of handlers) process.on(signal, handler);
    let settled = false;
    const settle = (): boolean => {
      if (settled) return false;
      settled = true;
      for (const [signal, handler] of handlers) process.off(signal, handler);
      return true;
    };
    child.on('error', (err) => {
      if (settle()) reject(err);
    });
    child.on('exit', (code, signal) => {
      if (settle()) resolve({ code, signal });
    });
  });
}
