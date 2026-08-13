// src/lib/retryBackoff.ts
//
// fix/tablet-robustez (12/08). Reintento con espera creciente para lecturas
// y latido de la tablet: 1s, 2s, 5s, 10s, 30s, y desde ahí cada 30s PARA
// SIEMPRE — nunca se rinde. Solo para lecturas/latido (Tarea B del
// encargo): las escrituras de usuario (marcar línea, bump, cobrar) NO usan
// esto — ahí un reintento automático puede duplicar la acción.
//
// Distingue explícitamente "el servidor rechazó esto de verdad" (para de
// reintentar, ver isExplicitRejection) de "no hay red / tarda / lo que sea"
// (reintenta siempre). Esa distinción es el corazón del incidente del 11/08:
// un timeout de 3s en kds_board se confundió con un token revocado y pidió
// vincular de nuevo una tablet que seguía perfectamente vinculada.

export type RetryState =
  | { phase: 'trying'; attempt: number; slow: boolean }
  | { phase: 'ok' }
  | { phase: 'rejected'; error: Error }

const SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000]
function delayFor(attempt: number): number {
  return SCHEDULE_MS[Math.min(attempt, SCHEDULE_MS.length - 1)]
}

// Heurística para distinguir "sin red" (falla rápido: DNS/conexión
// rechazada) de "responde pero tarda" (falla tras varios segundos, típico
// de un timeout de servidor) — sin necesitar inspeccionar el tipo exacto
// de error, que varía entre fetch nativo y el cliente de Supabase.
const SLOW_THRESHOLD_MS = 2000

export interface RetryLoopHandle {
  cancel: () => void
}

/** Bucle RECURRENTE (latido, reclamo de trabajos de impresión — Tarea B):
 *  a diferencia de runRetryLoop (que termina al primer éxito), este sigue
 *  llamando para siempre a la cadencia normal; si falla, se aleja con el
 *  mismo backoff y vuelve a la cadencia normal en cuanto un intento
 *  funciona. Nunca distingue rechazo explícito — no aplica aquí, el
 *  latido/reclamo no muestran pantalla de vincular. */
export function runPollingLoop(opts: {
  call: () => Promise<void>
  normalIntervalMs: number
}): RetryLoopHandle {
  let cancelled = false
  let consecutiveFailures = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule(ms: number) {
    if (cancelled) return
    timer = setTimeout(() => { void tick() }, ms)
  }

  async function tick(): Promise<void> {
    if (cancelled) return
    try {
      await opts.call()
      consecutiveFailures = 0
      schedule(opts.normalIntervalMs)
    } catch {
      const delay = delayFor(consecutiveFailures)
      consecutiveFailures += 1
      schedule(delay)
    }
  }

  void tick()

  return {
    cancel() {
      cancelled = true
      if (timer) clearTimeout(timer)
    },
  }
}

export function runRetryLoop<T>(opts: {
  call: () => Promise<T>
  /** true = el servidor rechazó esto de verdad (p.ej. token inválido) — para de reintentar. */
  isExplicitRejection: (e: unknown) => boolean
  onState: (state: RetryState) => void
  onSuccess: (value: T) => void
}): RetryLoopHandle {
  let cancelled = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  async function tick(): Promise<void> {
    if (cancelled) return
    const startedAt = Date.now()
    try {
      const value = await opts.call()
      if (cancelled) return
      opts.onState({ phase: 'ok' })
      opts.onSuccess(value)
    } catch (e) {
      if (cancelled) return
      if (opts.isExplicitRejection(e)) {
        opts.onState({ phase: 'rejected', error: e instanceof Error ? e : new Error(String(e)) })
        return
      }
      const elapsed = Date.now() - startedAt
      const slow = elapsed >= SLOW_THRESHOLD_MS
      const thisAttempt = attempt + 1
      opts.onState({ phase: 'trying', attempt: thisAttempt, slow })
      const delay = delayFor(attempt)
      attempt += 1
      timer = setTimeout(() => { void tick() }, delay)
    }
  }

  opts.onState({ phase: 'trying', attempt: 0, slow: false })
  void tick()

  return {
    cancel() {
      cancelled = true
      if (timer) clearTimeout(timer)
    },
  }
}
