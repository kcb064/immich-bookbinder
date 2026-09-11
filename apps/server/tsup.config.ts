import { defineConfig } from 'tsup';

/**
 * Bundle the server into a single ESM file. Workspace packages ship TypeScript
 * source (main: ./src/index.ts), so they are inlined; everything from
 * node_modules stays external and is resolved at runtime.
 */
export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: ['@bookbinder/shared', '@bookbinder/layout'],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
