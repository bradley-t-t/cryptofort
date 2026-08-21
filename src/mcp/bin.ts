#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Vault } from '../vault.js';
import { buildServer } from './server.js';
import { adapterFromEnv, cryptoFromEnv } from './config.js';

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
  const allowWrite = process.argv.includes('--allow-write');
  const vault = new Vault({ adapter: await adapterFromEnv(), crypto: cryptoFromEnv() });
  const server = buildServer(vault, allowWrite);
  startPurgeLoop(vault);
  await server.connect(new StdioServerTransport());
  // stderr is safe for diagnostics; stdout is the MCP channel.
  console.error(`cryptofort-mcp ready (write ${allowWrite ? 'enabled' : 'disabled'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
