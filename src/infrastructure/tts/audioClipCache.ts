// In-memory TTS clip cache. Replaying a tutor line ("Listen") must not run
// VITS/ONNX inference again — the synthesized AudioBuffer is reused for the
// lifetime of the tab. Bounded LRU keeps memory predictable (one 5 s Russian
// clip at 22 kHz mono float32 is ~440 KB).
//
// Not persisted: a reload drops the clips. The model weights themselves stay
// in the browser Cache API, so the next synthesis is still fast.

export class LruCache<T> {
  private readonly map = new Map<string, T>()

  constructor(private readonly maxEntries = 32) {}

  get size(): number {
    return this.map.size
  }

  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    // refresh recency
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** Stable cache key: engine/model/voice/text, whitespace-collapsed. */
export function speechCacheKey(parts: Array<string | number>): string {
  return parts
    .map(part =>
      String(part)
        .trim()
        .replace(/\s+/g, ' '),
    )
    .join('|')
}
