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
//
// fix/sondeo-adaptativo-tablet (13/08, Encargo B): backoff ante INACTIVIDAD,
// que conviven con el de fallo de arriba sin pisarlo (ver runPollingLoop):
//   - Fallo -> esperar más para no machacar una base que va mal (ya existía).
//   - Inactividad -> esperar más porque no hay nada que hacer (esto es nuevo).
// Causa raíz: docs/claude_folvy_incidente_20260813_conexiones_causa_raiz.md —
// 3 tablets, cocinas cerradas, ~18.000 peticiones en 2,5h porque sondean a
// ritmo fijo y nadie les dijo nunca que no hay nada que hacer.

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

// B2: "local cerrado" — no hay una señal fiable única (RECON: business_hours
// existe pero no todos los locales lo tienen cargado, y de todas formas no
// reacciona a un toque en pantalla). Se usa la señal explícita del propio
// encargo: 60 min SEGUIDOS sin actividad real (ningún poll con trabajo) tira
// el ritmo al suelo, pase lo que pase con idleIntervalMs. Vuelve al instante
// en cuanto haya trabajo o alguien toque la pantalla (ver wake()).
const CLOSED_AFTER_MS = 60 * 60 * 1000
const CLOSED_INTERVAL_MS = 5 * 60 * 1000

export interface RetryLoopHandle {
  cancel: () => void
  /** Actividad real del usuario (toque en pantalla) — Tarea B2: descarta lo
   *  que quede de la espera actual y sondea ya, al ritmo normal. */
  wake: () => void
}

/** Bucle RECURRENTE (latido, reclamo de trabajos de impresión, lecturas del
 *  pase — Tarea B): a diferencia de runRetryLoop (que termina al primer
 *  éxito), este sigue llamando para siempre a la cadencia normal; si falla,
 *  se aleja con el mismo backoff y vuelve a la cadencia normal en cuanto un
 *  intento funciona. Nunca distingue rechazo explícito — no aplica aquí, el
 *  latido/reclamo no muestran pantalla de vincular.
 *
 *  Ritmo adaptativo por INACTIVIDAD (opcional, Tarea B1+B2): `call` informa
 *  si hubo trabajo devolviendo `false` explícito cuando NO lo hubo (vacío);
 *  cualquier otra cosa (`true`/`void`) cuenta como actividad y reinicia AL
 *  INSTANTE al ritmo normal, sin histéresis. Sin `idleIntervalMs`+`idleAfter`
 *  el bucle se comporta exactamente como antes (ritmo fijo + backoff de
 *  fallo) — así el latido (que no pasa estas opciones) queda intacto.
 *  Tras `idleAfter` ciclos vacíos seguidos, el intervalo sube PROGRESIVAMENTE
 *  (dobla cada ciclo, nunca de golpe) hasta `idleIntervalMs`. Si la racha
 *  vacía sigue 60 min reales (B2, "local cerrado"), el suelo baja más, a
 *  1 llamada cada 5 min, independientemente de `idleIntervalMs`.
 *  El backoff de fallo y el de inactividad NO se interfieren: un fallo no
 *  reinicia la racha de inactividad, solo pausa su avance mientras reintenta. */
export function runPollingLoop(opts: {
  call: () => Promise<boolean | void>
  normalIntervalMs: number
  idleIntervalMs?: number
  idleAfter?: number
}): RetryLoopHandle {
  let cancelled = false
  let consecutiveFailures = 0
  let consecutiveIdle = 0
  let idleSinceMs: number | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  function nextDelay(): number {
    const { normalIntervalMs, idleIntervalMs, idleAfter } = opts
    if (!idleIntervalMs || !idleAfter || consecutiveIdle < idleAfter) return normalIntervalMs
    if (idleSinceMs !== null && Date.now() - idleSinceMs >= CLOSED_AFTER_MS) {
      return CLOSED_INTERVAL_MS
    }
    const ticksPastThreshold = consecutiveIdle - idleAfter + 1
    const ratio = idleIntervalMs / normalIntervalMs
    const factor = Math.min(2 ** ticksPastThreshold, ratio)
    return Math.min(Math.round(normalIntervalMs * factor), idleIntervalMs)
  }

  function schedule(ms: number) {
    if (cancelled) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void tick() }, ms)
  }

  async function tick(): Promise<void> {
    if (cancelled) return
    try {
      const hadWork = await opts.call()
      consecutiveFailures = 0
      if (hadWork === false) {
        consecutiveIdle += 1
        if (idleSinceMs === null) idleSinceMs = Date.now()
      } else {
        consecutiveIdle = 0
        idleSinceMs = null
      }
      schedule(nextDelay())
    } catch {
      // No toca consecutiveIdle/idleSinceMs: el fallo no cuenta como
      // actividad ni la interrumpe, solo aplaza el próximo intento.
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
    wake() {
      if (cancelled) return
      consecutiveIdle = 0
      idleSinceMs = null
      if (timer) { clearTimeout(timer); timer = null }
      void tick()
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
    wake() {
      if (cancelled) return
      if (timer) { clearTimeout(timer); timer = null }
      void tick()
    },
  }
}
