// Tiny typed event bus: repositories publish "data changed" events, sync and
// UI features subscribe. No DOM, no React — trivially testable.

import type { DataChange, DataChangeListener, EventBusPort } from '../ports'

export class EventBus implements EventBusPort {
  private readonly listeners = new Set<DataChangeListener>()

  publish(change: DataChange): void {
    for (const fn of this.listeners) {
      try {
        fn(change)
      } catch {
        /* a listener error must never break the write that caused it */
      }
    }
  }

  subscribe(listener: DataChangeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** Minimal observable used by application services (no React dependency). */
export class Observable<T> {
  private readonly listeners = new Set<(value: T) => void>()

  constructor(private value: T) {}

  get(): T {
    return this.value
  }

  set(next: T): void {
    this.value = next
    this.emit()
  }

  update(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch }
    this.emit()
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    listener(this.value)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn(this.value)
      } catch {
        /* one broken listener must not stop the others */
      }
    }
  }
}
