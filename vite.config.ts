import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { extname, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** piper-tts-web fetches its runtime assets (onnxruntime wasm, the phonemizer
 *  and the workers) from the site root: /onnx/*, /piper/*, /worker/*.
 *
 *  In dev we serve them straight from node_modules with the correct MIME type.
 *  Copying them into public/ from `configureServer` is too late: Vite's static
 *  middleware has already snapshotted publicDir, so the first run answers
 *  index.html for every asset and WebAssembly.instantiateStreaming dies with
 *  "Incorrect response MIME type. Expected 'application/wasm'". Serving them
 *  ourselves removes that first-run trap (and keeps 108 MB out of public/).
 *  The production build still copies the files next to index.html. */
function piperAssets(): Plugin {
  const dirs = ['onnx', 'piper', 'worker']
  const srcRoot = resolve(__dirname, 'node_modules/piper-tts-web/dist')
  const roots = new Map(dirs.map(dir => [dir, resolve(srcRoot, dir)]))
  const MIME: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.data': 'application/octet-stream',
    '.onnx': 'application/octet-stream',
  }

  const copy = (target: string) => {
    for (const dir of dirs) {
      const from = resolve(srcRoot, dir)
      if (!existsSync(from)) continue
      const to = resolve(target, dir)
      mkdirSync(to, { recursive: true })
      cpSync(from, to, { recursive: true })
    }
  }

  const serve = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void => {
    let pathname: string
    try {
      pathname = decodeURIComponent((req.url ?? '').split('?')[0])
    } catch {
      next()
      return
    }
    const match = /^\/(onnx|piper|worker)\/(.+)$/.exec(pathname)
    if (!match) {
      next()
      return
    }
    const base = roots.get(match[1])
    if (!base) {
      next()
      return
    }
    const file = resolve(base, normalize(match[2]))
    // no path traversal
    if (!file.startsWith(base + sep)) {
      res.statusCode = 403
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('forbidden')
      return
    }
    // an asset URL must never fall through to index.html: that is exactly the
    // text/html response that breaks WebAssembly.instantiateStreaming
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('piper asset not found')
      return
    }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    res.setHeader('Content-Length', statSync(file).size)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.statusCode = 200
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    createReadStream(file).pipe(res)
  }

  return {
    name: 'piper-assets',
    configureServer(server) {
      server.middlewares.use(serve)
    },
    configurePreviewServer(server) {
      // `vite preview` serves dist/; this is a fallback for a stale build.
      server.middlewares.use(serve)
    },
    writeBundle() {
      copy(resolve(__dirname, 'dist'))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), piperAssets()],
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['phonon-tts'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
  server: {
    port: 5175,
    // StepFun does not send CORS headers to browsers. In dev, cloudChat
    // routes a direct api.stepfun.ai base URL through this same-origin proxy.
    // A static production build needs its own proxy (Cloudflare Worker etc.).
    proxy: {
      '/__cloud/stepfun': {
        target: process.env.STEPFUN_PROXY_TARGET ?? 'https://api.stepfun.ai',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/__cloud\/stepfun/, ''),
      },
    },
  },
})
