import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser version: no proxy to the Python backend — all ML runs inside the tab.
export default defineConfig({
  plugins: [react()],
  // phonon-tts uses a module worker with dynamic imports — Vite's default
  // iife worker format does not support code splitting
  worker: { format: 'es' },
  // and prebundling breaks it: optimizeDeps rewrites new URL('./worker.js', import.meta.url)
  optimizeDeps: { exclude: ['phonon-tts'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // deu-rus.json (2.2 MB) is inlined into the bundle as a plain JSON module
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5174,
  },
})
