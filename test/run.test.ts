import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MissingCredentialError,
  UsageError,
  childEnv,
  loadEnvFile,
  parseRunArgs,
  resolveCredentials,
  runCommand,
  variableFor,
} from '../src/cli/run.js';
import { Vault } from '../src/vault.js';
import { Crypto, generateKey } from '../src/crypto.js';
import { SqliteAdapter } from '../src/adapters/sqlite.js';

async function makeVault() {
  const adapter = new SqliteAdapter(':memory:');
  await adapter.init();
  return new Vault({ adapter, crypto: new Crypto({ key: generateKey() }) });
}

describe('variableFor', () => {
  it('upper-cases a credential name and turns separators into underscores', () => {
    expect(variableFor('stripe-secret-key')).toBe('STRIPE_SECRET_KEY');
    expect(variableFor('db.url/primary')).toBe('DB_URL_PRIMARY');
  });

  it('never yields a name that starts with a digit', () => {
    expect(variableFor('1password-token')).toBe('_1PASSWORD_TOKEN');
  });
});

describe('parseRunArgs', () => {
  it('maps named and derived variables and keeps the command whole', () => {
    expect(
      parseRunArgs(['db-url=DATABASE_URL', 'stripe-key', '--', 'node', 'a.js', '--x']),
    ).toEqual({
      namespace: 'default',
      mappings: [
        { name: 'db-url', variable: 'DATABASE_URL' },
        { name: 'stripe-key', variable: 'STRIPE_KEY' },
      ],
      command: ['node', 'a.js', '--x'],
    });
  });

  it('reads the namespace in both spellings', () => {
    expect(parseRunArgs(['--namespace', 'staging', 'k', '--', 'x']).namespace).toBe('staging');
    expect(parseRunArgs(['--namespace=prod', 'k', '--', 'x']).namespace).toBe('prod');
    expect(parseRunArgs(['-n', 'qa', 'k', '--', 'x']).namespace).toBe('qa');
  });

  it('reads an env file in both spellings', () => {
    expect(parseRunArgs(['--env-file', '/v.env', 'k', '--', 'x']).envFile).toBe('/v.env');
    expect(parseRunArgs(['--env-file=/v.env', 'k', '--', 'x']).envFile).toBe('/v.env');
    expect(parseRunArgs(['k', '--', 'x'])).not.toHaveProperty('envFile');
  });

  it('leaves everything after the first -- to the command', () => {
    expect(parseRunArgs(['k', '--', 'sh', '-c', 'echo --', '--']).command).toEqual([
      'sh',
      '-c',
      'echo --',
      '--',
    ]);
  });

  it.each([
    [['k', 'echo'], 'put --'],
    [['k', '--'], 'nothing to run'],
    [['--', 'echo'], 'at least one credential'],
    [['--namespace', '--', 'echo'], 'needs a value'],
    [['--env-file', 'k'], 'put --'],
    [['--env-file=', 'k', '--', 'echo'], 'needs a value'],
    [['-n', '--env-file', 'v', 'k', '--', 'echo'], 'needs a value'],
    [['--verbose', 'k', '--', 'echo'], 'unknown option'],
    [['k=1BAD', '--', 'echo'], 'not an environment variable name'],
    [['=VAR', '--', 'echo'], 'names no credential'],
    [['a=X', 'b=X', '--', 'echo'], 'more than one credential'],
  ])('refuses %j', (args, message) => {
    expect(() => parseRunArgs(args)).toThrow(UsageError);
    expect(() => parseRunArgs(args)).toThrow(message);
  });
});

describe('childEnv', () => {
  it('drops the variables that open the vault and adds the named credentials', () => {
    const env = childEnv(
      {
        PATH: '/usr/bin',
        CRYPTOFORT_MASTER_KEY: 'master',
        CRYPTOFORT_POSTGRES_URL: 'postgres://vault',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        SUPABASE_URL: 'https://ref.supabase.co',
      },
      { STRIPE_KEY: 'sk_live_1' },
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      SUPABASE_URL: 'https://ref.supabase.co',
      STRIPE_KEY: 'sk_live_1',
    });
  });

  it('still sets a vault variable the command line mapped a credential onto', () => {
    const env = childEnv(
      { SUPABASE_SERVICE_ROLE_KEY: 'vault' },
      { SUPABASE_SERVICE_ROLE_KEY: 'app' },
    );
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('app');
  });
});

describe('loadEnvFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cryptofort-run-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function envFile(mode: number): string {
    const path = join(dir, 'vault.env');
    writeFileSync(path, 'CRYPTOFORT_ADAPTER=sqlite\nCRYPTOFORT_MASTER_KEY="abc="\n');
    chmodSync(path, mode);
    return path;
  }

  it('loads a file only its owner can read', () => {
    const target: NodeJS.ProcessEnv = {};
    loadEnvFile(envFile(0o600), target);
    expect(target).toEqual({ CRYPTOFORT_ADAPTER: 'sqlite', CRYPTOFORT_MASTER_KEY: 'abc=' });
  });

  it.skipIf(process.platform === 'win32')('refuses a file other users can read', () => {
    const target: NodeJS.ProcessEnv = {};
    expect(() => loadEnvFile(envFile(0o644), target)).toThrow('chmod 600');
    expect(target).toEqual({});
  });

  it('reads a leading ~/ as the home directory', () => {
    expect(() => loadEnvFile('~/cryptofort-no-such-file.env', {})).toThrow(
      join(homedir(), 'cryptofort-no-such-file.env'),
    );
  });

  it('names a file that is not there', () => {
    expect(() => loadEnvFile(join(dir, 'absent.env'), {})).toThrow('no env file at');
  });
});

describe('resolveCredentials', () => {
  let vault: Vault;
  beforeEach(async () => {
    vault = await makeVault();
    await vault.put({ name: 'stripe-key', secret: 'sk_live_1' });
    await vault.put({ name: 'db-url', secret: 'postgres://staging', namespace: 'staging' });
  });

  it('decrypts each credential into the variable it was mapped to', async () => {
    const plan = parseRunArgs(['stripe-key', 'stripe-key=OTHER', '--', 'x']);
    expect(await resolveCredentials(vault, plan)).toEqual({
      STRIPE_KEY: 'sk_live_1',
      OTHER: 'sk_live_1',
    });
  });

  it('reads from the namespace the command line names', async () => {
    const plan = parseRunArgs(['-n', 'staging', 'db-url', '--', 'x']);
    expect(await resolveCredentials(vault, plan)).toEqual({ DB_URL: 'postgres://staging' });
  });

  it('names every missing credential and resolves none', async () => {
    const plan = parseRunArgs(['stripe-key', 'nope', 'db-url', '--', 'x']);
    const err = await resolveCredentials(vault, plan).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingCredentialError);
    expect((err as MissingCredentialError).names).toEqual(['nope', 'db-url']);
    expect((err as Error).message).not.toContain('sk_live_1');
  });

  it('treats an expired credential as missing', async () => {
    await vault.put({ name: 'old', secret: 'v', expiresAt: '2000-01-01T00:00:00Z' });
    const plan = parseRunArgs(['old', '--', 'x']);
    await expect(resolveCredentials(vault, plan)).rejects.toThrow(MissingCredentialError);
  });
});

describe('runCommand', () => {
  it('runs the command with the environment it was given and returns its exit code', async () => {
    const script =
      'process.exit(process.env.STRIPE_KEY === "sk_live_1" && !process.env.CRYPTOFORT_MASTER_KEY ? 7 : 1)';
    const env = childEnv(
      { ...process.env, CRYPTOFORT_MASTER_KEY: 'master' },
      { STRIPE_KEY: 'sk_live_1' },
    );
    expect(await runCommand([process.execPath, '-e', script], env)).toEqual({
      code: 7,
      signal: null,
    });
  });

  it('reports a command stopped by a signal', async () => {
    const script = 'process.kill(process.pid, "SIGTERM")';
    expect(await runCommand([process.execPath, '-e', script], process.env)).toEqual({
      code: null,
      signal: 'SIGTERM',
    });
  });

  it('rejects with the spawn error when the command does not exist', async () => {
    await expect(runCommand(['cryptofort-no-such-command'], process.env)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
