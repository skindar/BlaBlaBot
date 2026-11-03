import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Browser version: no proxy to the Python backend — all ML runs inside the tab.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
