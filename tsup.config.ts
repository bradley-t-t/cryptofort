import { defineConfig } from 'tsup';
import { createRequire } from 'node:module';

// The server announces this over MCP. Reading it from package.json at build time
// keeps the two from drifting, which is the only way a released binary can go on
// reporting a version the project left behind.
const { version } = createRequire(import.meta.url)('./package.json') as { version: string };

export default defineConfig({
  entry: ['src/index.ts', 'src/mcp/server.ts', 'src/mcp/bin.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  define: { __CRYPTOFORT_VERSION__: JSON.stringify(version) },
});
