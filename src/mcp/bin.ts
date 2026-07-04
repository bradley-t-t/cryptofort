#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Vault } from '../vault.js';
import { buildServer } from './server.js';
import { adapterFromEnv, cryptoFromEnv } from './config.js';

async function main(): Promise<void> {
  const allowWrite = process.argv.includes('--allow-write');
  const vault = new Vault({ adapter: await adapterFromEnv(), crypto: cryptoFromEnv() });
  const server = buildServer(vault, allowWrite);
  await server.connect(new StdioServerTransport());
  // stderr is safe for diagnostics; stdout is the MCP channel.
  console.error(`cryptofort-mcp ready (write ${allowWrite ? 'enabled' : 'disabled'})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
