#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Vault } from '../vault.js';
import { buildServer } from './server.js';
import { adapterFromEnv, cryptoFromEnv } from './config.js';
import { EnvValueError } from './env.js';

// Expired credentials are deleted lazily on read, but a purge sweep makes sure
// they leave the database even when nobody asks for them. Runs at startup and
// then hourly; this enforces expiries the vault owner already set, so it does
// not depend on --allow-write. unref() keeps the timer from holding the
// process open once the stdio channel closes.
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

function startPurgeLoop(vault: Vault): void {
  const purge = async (): Promise<void> => {
    try {
      const purged = await vault.purgeExpired();
      if (purged > 0) console.error(`cryptofort-mcp purged ${purged} expired credential(s)`);
    } catch (err) {
      console.error('cryptofort-mcp purge failed:', err);
    }
  };
  void purge();
  setInterval(purge, PURGE_INTERVAL_MS).unref();
}

async function main(): Promise<void> {
  const access = {
    allowWrite: process.argv.includes('--allow-write'),
    allowSecretRead: process.argv.includes('--allow-secret-read'),
    allowDelete: process.argv.includes('--allow-delete'),
  };
  const vault = new Vault({ adapter: await adapterFromEnv(), crypto: cryptoFromEnv() });
  const server = buildServer(vault, access);
  startPurgeLoop(vault);
  await server.connect(new StdioServerTransport());
  // stderr is safe for diagnostics; stdout is the MCP channel. Both permissions
  // are named on every start, because a server that silently has more than the
  // operator meant to give it is the failure worth catching at the handshake.
  const on = (v: boolean): string => (v ? 'enabled' : 'disabled');
  console.error(
    `cryptofort-mcp ready (secret read ${on(access.allowSecretRead)}, write ${on(access.allowWrite)}, delete ${on(access.allowDelete)})`,
  );
}

main().catch((err) => {
  // A refused configuration value is one sentence naming the variable and what
  // is wrong with it, and it reaches an operator through the MCP client's log
  // rather than a terminal. A stack trace in front of it is what stops it being
  // read, so only an unexpected failure gets one.
  console.error(err instanceof EnvValueError ? err.message : err);
  process.exit(1);
});
