#!/usr/bin/env node
import { constants } from 'node:os';
import { Vault } from '../vault.js';
import { adapterFromEnv, cryptoFromEnv } from '../mcp/config.js';
import { EnvValueError } from '../mcp/env.js';
import {
  MissingCredentialError,
  RUN_USAGE,
  UsageError,
  childEnv,
  loadEnvFile,
  parseRunArgs,
  resolveCredentials,
  runCommand,
} from './run.js';

// Replaced at bundle time from package.json, as in the MCP server.
declare const __CRYPTOFORT_VERSION__: string | undefined;
const VERSION = typeof __CRYPTOFORT_VERSION__ === 'string' ? __CRYPTOFORT_VERSION__ : '0.0.0-dev';

const USAGE = `${RUN_USAGE}

       cryptofort --version`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return 0;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (command === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (command !== 'run') throw new UsageError(`cryptofort: unknown command '${command}'`);
  if (rest[0] === '--help' || rest[0] === '-h') {
    console.log(RUN_USAGE);
    return 0;
  }

  const plan = parseRunArgs(rest);
  // The command inherits the environment as it was before any env file was read,
  // so the vault configuration in the file reaches this process and no further.
  const inherited = { ...process.env };
  if (plan.envFile !== undefined) loadEnvFile(plan.envFile);
  const vault = new Vault({ adapter: await adapterFromEnv(), crypto: cryptoFromEnv() });
  const secrets = await resolveCredentials(vault, plan);
  let result;
  try {
    result = await runCommand(plan.command, childEnv(inherited, secrets));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.error(`cryptofort run: ${plan.command[0]}: command not found`);
      return 127;
    }
    if (code === 'EACCES') {
      console.error(`cryptofort run: ${plan.command[0]}: permission denied`);
      return 126;
    }
    throw err;
  }
  // A command stopped by a signal is reported the way a shell reports it, as
  // 128 plus the signal's number, so a caller sees an interrupt and not success.
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 0);
  return result.code ?? 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    // Every failure CryptoFort raises itself is one sentence, prefixed with its
    // name, that says what to fix; only an unexpected one gets a stack trace. No
    // message here carries a credential: the values exist only in the command's
    // environment.
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${RUN_USAGE}`);
      process.exit(2);
    }
    if (
      err instanceof EnvValueError ||
      err instanceof MissingCredentialError ||
      (err instanceof Error && err.message.startsWith('cryptofort'))
    ) {
      console.error(err.message);
    } else {
      console.error(err);
    }
    process.exit(1);
  },
);
