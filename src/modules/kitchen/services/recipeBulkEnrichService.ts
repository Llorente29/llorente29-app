// src/modules/kitchen/services/recipeBulkEnrichService.ts
//
// COMPLETADO MASIVO con IA de ingredientes pendientes (needs_review).
//
// Reutiliza EXACTAMENTE la cadena del botón individual (enrichIngredient +
// applyEnrichment): por cada ingrediente, la IA propone familia/alérgenos/merma/
// conservación; se aplican aceptando la propuesta; el IVA se deriva de la familia
// con el motor fiscal (propose_vat_category, no la IA). Si queda familia + IVA +
// sin incidencia, se retira needs_review. Anti-invención intacta: lo que la IA
// no resuelve con seguridad (sin familia fiable, sin precio/proveedor real) queda
// pendiente. NO inventa coste, proveedor ni formato — eso lo carga el humano.
//
// CONTROL DE RATE LIMIT: se procesa en serie con una pausa entre llamadas y con
// reintentos con espera creciente (backoff) cuando la API responde 429/límite.
// Sin esto, disparar decenas de llamadas seguidas satura el rate limit de la API
// y la segunda mitad falla en bloque.

import { enrichIngredient, applyEnrichment } from './recipeAiService'

export interface BulkEnrichProgress {
  done: number          // procesados hasta ahora
  total: number         // total a procesar
  currentName: string   // ingrediente en curso
  finishedCount: number // cuántos quedaron "terminados" (sin needs_review)
  retrying: boolean     // true si está esperando para reintentar por saturación
}

export interface BulkEnrichResult {
  total: number
  finished: number      // terminados (familia + IVA + sin incidencia)
  partial: number       // procesados pero siguen pendientes (sin familia fiable, etc.)
  failed: number        // fallaron tras los reintentos
  failedNames: string[]
}

export interface BulkEnrichItem {
  id: string
  name: string
}

// Pausa base entre llamadas para no saturar el rate limit (ms).
const PAUSE_BETWEEN_MS = 450
// Reintentos ante saturación temporal (429 / rate limit / 5xx).
const MAX_RETRIES = 4

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ¿El error parece de saturación temporal (merece reintento con espera)?
function isTransient(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('limit') ||
    msg.includes('overloaded') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500') ||
    msg.includes('fetch')
  )
}

/**
 * Completa con IA una lista de ingredientes, en serie, respetando rate limits.
 *
 * @param accountId  cuenta
 * @param items      ingredientes a completar (id + name)
 * @param onProgress callback de progreso (opcional)
 */
export async function enrichIngredientsBulk(
  accountId: string,
  items: BulkEnrichItem[],
  onProgress?: (p: BulkEnrichProgress) => void,
): Promise<BulkEnrichResult> {
  let finished = 0
  let partial = 0
  let failed = 0
  const failedNames: string[] = []

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    onProgress?.({
      done: i,
      total: items.length,
      currentName: it.name,
      finishedCount: finished,
      retrying: false,
    })

    let ok = false
    let lastErr: unknown = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // 1) La IA propone (familia entre existentes, alérgenos, merma, conservación).
        const { proposal } = await enrichIngredient(it.id, accountId)

        // 2) Aplicar aceptando la propuesta. El IVA se deriva de la familia dentro
        //    de applyEnrichment (motor fiscal). Solo pasamos lo que la IA propuso.
        const result = await applyEnrichment(it.id, {
          familyId: proposal.family?.id ?? undefined,
          allergens: proposal.allergens.length > 0 ? proposal.allergens : undefined,
          defaultWastePct: proposal.defaultWastePct ?? undefined,
          conservationType: proposal.conservationType ?? undefined,
          shelfLifeDays: proposal.shelfLifeDays ?? undefined,
        })

        if (result.finished) finished++
        else partial++
        ok = true
        break
      } catch (err) {
        lastErr = err
        // Si es saturación temporal y quedan intentos, esperar (backoff) y reintentar.
        if (isTransient(err) && attempt < MAX_RETRIES) {
          const waitMs = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s, 8s
          onProgress?.({
            done: i,
            total: items.length,
            currentName: it.name,
            finishedCount: finished,
            retrying: true,
          })
          await sleep(waitMs)
          continue
        }
        // Error no transitorio o sin intentos: se cuenta como fallo y se sigue.
        break
      }
    }

    if (!ok) {
      failed++
      failedNames.push(it.name)
      void lastErr
    }

    // Pausa entre ingredientes para no saturar el rate limit.
    if (i < items.length - 1) await sleep(PAUSE_BETWEEN_MS)
  }

  onProgress?.({
    done: items.length,
    total: items.length,
    currentName: '',
    finishedCount: finished,
    retrying: false,
  })

  return { total: items.length, finished, partial, failed, failedNames }
}
