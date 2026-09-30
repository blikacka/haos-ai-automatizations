import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import {
    cp,
    mkdir,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises'

const outDir = 'dist/web'

/** Short content hash used as a cache-busting query (?v=…) for app.js and styles.css. */
async function contentHash(...files) {
    const hash = createHash('sha256')
    for (const file of files) {
        hash.update(await readFile(file))
    }
    return hash.digest('hex').slice(0, 12)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
await cp('public', outDir, { recursive: true })
await rm(`${outDir}/css`, { recursive: true, force: true })
await build({
    entryPoints: ['src/web/main.ts'],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    sourcemap: true,
    outfile: `${outDir}/app.js`,
})
// Bundles styles.css with all its @import files into one stylesheet.
await build({
    entryPoints: ['public/styles.css'],
    bundle: true,
    minify: true,
    outfile: `${outDir}/styles.css`,
})

const version = await contentHash(`${outDir}/app.js`, `${outDir}/styles.css`)
const indexPath = `${outDir}/index.html`
const index = (await readFile(indexPath, 'utf8'))
    .replace('href="./styles.css"', `href="./styles.css?v=${version}"`)
    .replace('src="./app.js"', `src="./app.js?v=${version}"`)
if (!index.includes(`?v=${version}`)) {
    throw new Error('index.html asset references not found – cache busting not applied')
}
await writeFile(indexPath, index)
