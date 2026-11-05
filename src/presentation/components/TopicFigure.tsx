// The topic card's figure: rebuilt into a random construction on every
// "explore another topic" click. The shape is either a particle sphere,
// a beam-lattice cube or a superellipsoid ("between a sphere and a cube"),
// and the waves inside get their own random functions — sine/cosine phase,
// period, amplitude, speed, direction — sometimes the whole wave field
// slowly rotates.

import { useEffect, useRef } from 'react'

const SIZE = 160 // css px
const C = SIZE / 2
const R = 60 // figure radius

interface P3 {
  x: number
  y: number
  z: number
}

interface Dot extends P3 {
  size: number
  tw: number
}

interface WaveConf {
  base: number
  amp: number
  period: number
  phase: number
  speed: number
  dir: number
  alpha: number
}

type Kind = 'sphere' | 'supercube' | 'lattice'

interface Figure {
  kind: Kind
  dots: Dot[]
  lines: Array<[P3, P3]>
  corners: P3[]
  waves: WaveConf[]
  wavesRotate: boolean
  clipR: number
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a)

/** 1-2 interior planes per axis, jittered; the bounding edges always kept */
function latticeLines(): { lines: Array<[P3, P3]>; corners: P3[] } {
  const divs = 1 + Math.floor(Math.random() * 2)
  const axis = () => {
    const vals = [-R, R]
    for (let i = 1; i <= divs; i++) vals.push((2 * R * i) / (divs + 1) - R + rnd(-3.5, 3.5))
    return vals
  }
  const gx = axis()
  const gy = axis()
  const gz = axis()
  const isEdge = (a: number, b: number) =>
    Math.abs(Math.abs(a) - R) < 0.01 && Math.abs(Math.abs(b) - R) < 0.01
  const keep = () => Math.random() < (divs === 1 ? 0.85 : 0.62)
  const lines: Array<[P3, P3]> = []
  for (const a of gy)
    for (const b of gz) if (isEdge(a, b) || keep()) lines.push([{ x: -R, y: a, z: b }, { x: R, y: a, z: b }])
  for (const a of gx)
    for (const b of gz) if (isEdge(a, b) || keep()) lines.push([{ x: a, y: -R, z: b }, { x: a, y: R, z: b }])
  for (const a of gx)
    for (const b of gy) if (isEdge(a, b) || keep()) lines.push([{ x: a, y: b, z: -R }, { x: a, y: b, z: R }])
  const corners: P3[] = []
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push({ x: sx * R, y: sy * R, z: sz * R })
  return { lines, corners }
}

/** particles on a sphere (exponent 2) or a rounded cube (higher exponent) */
function surfaceDots(exponent: number, count: number): Dot[] {
  const dots: Dot[] = Array.from({ length: count }, (_, i) => {
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    const dx = Math.sin(phi) * Math.cos(theta)
    const dy = Math.sin(phi) * Math.sin(theta)
    const dz = Math.cos(phi)
    const denom = Math.pow(Math.abs(dx) ** exponent + Math.abs(dy) ** exponent + Math.abs(dz) ** exponent, 1 / exponent)
    const s = R / denom
    return { x: dx * s, y: dy * s, z: dz * s, size: rnd(1.3, 2.7), tw: rnd(0, Math.PI * 2) }
  })
  return dots
}

function buildFigure(): Figure {
  const roll = Math.random()
  const kind: Kind = roll < 0.34 ? 'sphere' : roll < 0.68 ? 'supercube' : 'lattice'
  const figure: Figure = {
    kind,
    dots: [],
    lines: [],
    corners: [],
    waves: [],
    wavesRotate: Math.random() < 0.28,
    clipR: R - 8,
  }
  if (kind === 'lattice') {
    const { lines, corners } = latticeLines()
    figure.lines = lines
    figure.corners = corners
    figure.clipR = R + 4
  } else {
    figure.dots = surfaceDots(kind === 'sphere' ? 2 : rnd(3.4, 8), kind === 'sphere' ? 88 : 104)
  }
  // the waves: 2-3 lines, each with its own sine/cosine character
  const waveCount = Math.random() < 0.3 ? 3 : 2
  for (let i = 0; i < waveCount; i++) {
    const base = -18 + (36 * i) / Math.max(1, waveCount - 1) + rnd(-3, 3)
    figure.waves.push({
      base,
      amp: rnd(5, 11),
      period: rnd(38, 72),
      phase: rnd(0, Math.PI * 2),
      speed: rnd(3, 7.5),
      dir: Math.random() < 0.75 ? -1 : 1,
      alpha: rnd(0.28, 0.5),
    })
  }
  return figure
}

export function TopicFigure({ seed = 0 }: { seed?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const spinRef = useRef(0)

  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.scale(dpr, dpr)

    const figure = buildFigure()
    const TILT = -0.32
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let last = performance.now()
    let spin = spinRef.current
    let born = performance.now()

    const project = (p: P3) => {
      const ca = Math.cos(spin)
      const sa = Math.sin(spin)
      const ct = Math.cos(TILT)
      const st = Math.sin(TILT)
      const x = p.x * ca - p.z * sa
      const z0 = p.x * sa + p.z * ca
      const y = p.y * ct - z0 * st
      const z = p.y * st + z0 * ct
      const norm = Math.max(1, R)
      return { sx: C + x, sy: C + y, depth: z / norm }
    }

    const drawDotGrid = () => {
      ctx.fillStyle = '#526F60'
      const step = 17
      for (let row = -1; row * step * 0.87 < SIZE; row++) {
        for (let col = -1; col * step < SIZE + step; col++) {
          const x = col * step + (row % 2 === 0 ? 0 : step / 2)
          const y = row * step * 0.87 + 10
          if (x < 4 || x > SIZE - 4 || y < 4 || y > SIZE - 4) continue
          ctx.globalAlpha = 0.12
          ctx.beginPath()
          ctx.arc(x, y, 0.9, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    const drawWaves = (now: number, elapsed: number) => {
      ctx.save()
      ctx.beginPath()
      ctx.arc(C, C, figure.clipR, 0, Math.PI * 2)
      ctx.clip()
      if (figure.wavesRotate) {
        ctx.translate(C, C)
        ctx.rotate((elapsed / 30000) * Math.PI * 2)
        ctx.translate(-C, -C)
      }
      ctx.strokeStyle = '#526F60'
      ctx.lineWidth = 1.4
      ctx.lineJoin = 'round'
      for (const w of figure.waves) {
        const drift = now * 0.001 * w.speed * w.dir
        ctx.globalAlpha = w.alpha
        ctx.beginPath()
        for (let x = 8; x <= SIZE - 8; x += 2.5) {
          const y = C + w.base - w.amp * Math.sin(((x + drift) / w.period) * Math.PI * 2 + w.phase)
          if (x === 8) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    }

    const draw = (now: number) => {
      const dt = Math.min(100, now - last) / 1000
      last = now
      const elapsed = now - born
      if (!reduced) {
        spin += dt * ((Math.PI * 2) / 46)
        spinRef.current = spin
      }
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = '#526F60'
      ctx.strokeStyle = '#526F60'

      drawDotGrid()

      const drawDotHalf = (front: boolean) => {
        for (const d of figure.dots) {
          const pr = project(d)
          const isFront = pr.depth >= 0
          if (isFront !== front) continue
          const k = front ? pr.depth : (pr.depth + 1) / 2
          const twinkle = 0.85 + 0.15 * Math.sin(now / 620 + d.tw)
          ctx.globalAlpha = front ? (0.22 + 0.42 * k) * twinkle : 0.1 + 0.16 * k
          ctx.beginPath()
          ctx.arc(pr.sx, pr.sy, d.size * (front ? 0.7 + 0.5 * k : 0.6 + 0.4 * k), 0, Math.PI * 2)
          ctx.fill()
        }
      }

      const drawLineHalf = (front: boolean) => {
        ctx.lineWidth = 1
        ctx.lineCap = 'round'
        for (const [a, b] of figure.lines) {
          const pa = project(a)
          const pb = project(b)
          const depth = (pa.depth + pb.depth) / 2
          const isFront = depth >= 0
          if (isFront !== front) continue
          const k = (depth + 1) / 2
          ctx.globalAlpha = 0.14 + 0.4 * k
          ctx.beginPath()
          ctx.moveTo(pa.sx, pa.sy)
          ctx.lineTo(pb.sx, pb.sy)
          ctx.stroke()
        }
        for (const p of figure.corners) {
          const pr = project(p)
          const isFront = pr.depth >= 0
          if (isFront !== front) continue
          const k = (pr.depth + 1) / 2
          ctx.globalAlpha = 0.3 + 0.45 * k
          ctx.beginPath()
          ctx.arc(pr.sx, pr.sy, 1.5 + k, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      const isDots = figure.kind !== 'lattice'
      if (isDots) drawDotHalf(false)
      else drawLineHalf(false)

      drawWaves(now, elapsed)

      if (isDots) drawDotHalf(true)
      else drawLineHalf(true)
      ctx.globalAlpha = 1

      if (!reduced) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [seed])

  return <canvas ref={ref} aria-hidden="true" style={{ width: SIZE, height: SIZE, display: 'block' }} />
}
