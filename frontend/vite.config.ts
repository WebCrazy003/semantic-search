import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * pdf.js loads character maps (needed for Chinese, Japanese and Korean PDFs), the
 * standard fonts and its image decoders at run time, from a URL. Served from our own
 * origin, under /pdfjs/, so the viewer never reaches for a CDN: in dev from node_modules,
 * in a build copied into dist/.
 */
function pdfjsAssets(): Plugin {
  const root = resolve(__dirname, 'node_modules/pdfjs-dist')
  const folders = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  return {
    name: 'docsage-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (request, response, next) => {
        const relative = decodeURIComponent((request.url ?? '').split('?')[0]).replace(/^\/+/, '')
        const [folder] = relative.split('/')
        const file = resolve(root, relative)
        if (!folders.includes(folder) || !file.startsWith(root + sep)) return next()
        try {
          if (!statSync(file).isFile()) return next()
        } catch {
          return next()
        }
        if (file.endsWith('.wasm')) response.setHeader('Content-Type', 'application/wasm')
        createReadStream(file).pipe(response)
      })
    },
    generateBundle() {
      for (const folder of folders) {
        for (const name of readdirSync(join(root, folder))) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${folder}/${name}`,
            source: readFileSync(join(root, folder, name)),
          })
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  server: {
    // Loopback by default, as the privacy requirement asks. `npm run dev:lan`
    // passes --host, which overrides this and exposes the UI to the network.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Only matters when serving on the network: allow this machine's own names.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/vitest.setup.ts'],
    css: false,
  },
})
