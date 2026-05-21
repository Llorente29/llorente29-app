// src/shell/eventBus.ts
//
// Bus de eventos del Shell (Bloque G, Sprint 3). Singleton tipado.
// Los módulos no se conocen entre sí: colaboran publicando/consumiendo
// eventos a través de este bus (doc reconciliado §5.3, Principio 3).
//
// Características:
//   - Síncrono en cliente: un módulo emite y los suscritos reaccionan en el
//     mismo tick. Procesamiento pesado debe disparar un job background, no
//     bloquear aquí.
//   - Tipado por `key` de evento (string canónico, ej. 'personal.clock.in').
//
// G-1: API completa y operativa. Tests en G-2.

type EventHandler<T = unknown> = (payload: T) => void

interface Subscription {
  key: string
  handler: EventHandler
}

class EventBus {
  private subscriptions: Subscription[] = []

  /**
   * Suscribe un handler a un evento. Devuelve una función para desuscribir.
   */
  subscribe<T = unknown>(key: string, handler: EventHandler<T>): () => void {
    const sub: Subscription = { key, handler: handler as EventHandler }
    this.subscriptions.push(sub)
    return () => {
      this.subscriptions = this.subscriptions.filter(s => s !== sub)
    }
  }

  /**
   * Publica un evento. Todos los handlers suscritos a esa key se ejecutan
   * de forma síncrona. Un error en un handler no impide que se ejecuten los
   * demás (se loggea y continúa).
   */
  publish<T = unknown>(key: string, payload: T): void {
    for (const sub of this.subscriptions) {
      if (sub.key !== key) continue
      try {
        sub.handler(payload)
      } catch (err) {
        console.error(`[eventBus] handler error para "${key}":`, err)
      }
    }
  }

  /** Nº de suscripciones activas (útil para tests y debug). */
  subscriberCount(key?: string): number {
    if (key === undefined) return this.subscriptions.length
    return this.subscriptions.filter(s => s.key === key).length
  }

  /** Limpia todas las suscripciones (útil en tests y al logout). */
  clear(): void {
    this.subscriptions = []
  }
}

// Singleton del Shell.
export const eventBus = new EventBus()

export type { EventHandler }
