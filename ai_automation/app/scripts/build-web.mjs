import { build } from 'esbuild'
import { cp, mkdir } from 'node:fs/promises'

const outDir = 'dist/web'

await mkdir(outDir, { recursive: true })
await build({
    entryPoints: ['src/web/main.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    outfile: `${outDir}/app.js`,
})
await cp('public', outDir, { recursive: true })
