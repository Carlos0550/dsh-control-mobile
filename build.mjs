import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
})
