// src/modules/supply/services/autoinventoryService.ts
//
// Autoinventario IA (A2). Lee la COLA PRIORIZADA del local: la RPC
// autoinventory_queue (SECURITY DEFINER, A1) decide QUE contar y CUANTO.
//
// QUE contar  = score rico: valor (stock parado) + rotacion (consumo) + riesgo
//               (varianza + merma), normalizado 0-1 por el max del local. La
//               criticidad operativa es OVERRIDE DURO (must_count), no peso.
// CUANTO contar = COBERTURA de valor, no cadencia fija: in_scope = must_count
//               OR la cobertura acumulada <= objetivo. El UNICO mando que el
//               gerente toca es ese objetivo de cobertura (coverageTarget).
//
// Solo lectura: la funcion no escribe nada. El motor (pesos, umbrales A/B/C)
// NO se expone en UI; aqui solo se pasan los dos parametros operativos.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

export interface AutoInventoryItem {
  recipeItemId: string
  name: string
  code: string | null
  baseUnit: string | null
  qtyOnHand: number
  stockValue: number
  rotationEur: number
  riskEur: number
  mustCount: boolean
  criticalReason: string | null
  /** Score 0-1 (valor·rotación·riesgo ponderados). */
  score: number
  /** Subscores normalizados 0-1 — confianza visible, el porqué del orden. */
  scoreValue: number
  scoreRotation: number
  scoreRisk: number
  /** Clase rica derivada por cobertura acumulada (A ≤80 % · B ≤95 % · C resto). */
  abcRich: 'A' | 'B' | 'C' | null
  /** Cobertura de valor acumulada hasta esta fila (% del valor del almacén). */
  coveragePct: number | null
  /** ¿Entra en la tanda de hoy? must_count OR cobertura ≤ objetivo. */
  inScope: boolean
  rank: number
}

export interface AutoInventoryQueueInput {
  accountId: string
  locationId: string
  /** Ventana de rotación en días (motor, no se expone en UI). Def. 30. */
  windowDays?: number
  /** Objetivo de cobertura de valor en % (único mando visible). Def. 80. */
  coverageTarget?: number
}

/**
 * Devuelve la cola priorizada del local, ya ordenada por rank.
 *
 * Importante: se envían SIEMPRE valores concretos a la RPC. Pasar `undefined`
 * a supabase-rpc lo serializa como `null` y pisaría los DEFAULT de la función
 * (un window NULL daría intervalo NULL → rotación vacía). Por eso el `?? 30` y
 * el `?? 80` viven aquí, no en la firma SQL.
 */
export async function getAutoInventoryQueue(
  input: AutoInventoryQueueInput
): Promise<AutoInventoryItem[]> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('autoinventory_queue', {
    p_account_id: input.accountId,
    p_location_id: input.locationId,
    p_window_days: input.windowDays ?? 30,
    p_coverage_target: input.coverageTarget ?? 80,
  })
  if (error) throw new Error(`No se pudo calcular el autoinventario: ${error.message}`)

  return ((data as Row[] | null) ?? []).map(r => ({
    recipeItemId: r.recipe_item_id as string,
    name: (r.name as string) ?? '(sin nombre)',
    code: (r.code as string | null) ?? null,
    baseUnit: (r.base_unit as string | null) ?? null,
    qtyOnHand: Number(r.qty_on_hand ?? 0),
    stockValue: Number(r.stock_value ?? 0),
    rotationEur: Number(r.rotation_eur ?? 0),
    riskEur: Number(r.risk_eur ?? 0),
    mustCount: Boolean(r.must_count),
    criticalReason: (r.critical_reason as string | null) ?? null,
    score: Number(r.score ?? 0),
    scoreValue: Number(r.score_value ?? 0),
    scoreRotation: Number(r.score_rotation ?? 0),
    scoreRisk: Number(r.score_risk ?? 0),
    abcRich: (r.abc_rich as 'A' | 'B' | 'C' | null) ?? null,
    coveragePct:
      r.coverage_pct === null || r.coverage_pct === undefined
        ? null
        : Number(r.coverage_pct),
    inScope: Boolean(r.in_scope),
    rank: Number(r.rank ?? 0),
  }))
}
