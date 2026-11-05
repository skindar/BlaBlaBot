import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

/** Copy Piper's runtime assets (onnx wasm, phonemizer, workers) to the site
 *  root. piper-tts-web fetches them by absolute path, so they must sit next
 *  to index.html in both dev (public/) and the build (dist/). */
function piperAssets(): Plugin {
  const dirs = ['onnx', 'piper', 'worker']
  const copy = (target: string) => {
    for (const dir of dirs) {
      const from = resolve(__dirname, 'node_modules/piper-tts-web/dist', dir)
      if (!existsSync(from)) continue
      const to = resolve(target, dir)
      mkdirSync(to, { recursive: true })
      cpSync(from, to, { recursive: true })
    }
  }
  return {
    name: 'piper-assets',
    // dev server: serve straight from node_modules
    configureServer(server) {
      copy(resolve(__dirname, 'public'))
      server.config.logger.info('piper-assets: copied onnx/piper/worker into public/')
    },
    writeBundle() {
      copy(resolve(__dirname, 'dist'))
    },
  }
}

// Browser version: no proxy to the Python backend — all ML runs inside the tab.
export default defineConfig({
  plugins: [react(), tailwindcss(), piperAssets()],
  // GitHub Pages project sites live at https://<owner>.github.io/<repo>/ —
  // relative asset paths work there and on a custom domain alike
  base: './',
  // phonon-tts uses a module worker with dynamic imports — Vite's default
  // iife worker format does not support code splitting
  worker: { format: 'es' },
  // and prebundling breaks it: optimizeDeps rewrites new URL('./worker.js', import.meta.url)
  optimizeDeps: { exclude: ['phonon-tts'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // deu-rus.json (2.2 MB) is a lazy dynamic-import chunk (see lib/store.ts):
    // only German learners download it, the main bundle stays small
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5174,
  },
})
