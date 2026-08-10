// src/modules/supply/services/negativeStockService.ts
//
// Vigía de stock negativo (Fase B, fiabilidad de almacén, 10/08). Lee
// negative_stock_report: artículos×local con qty_on_hand < 0, su causa
// probable y si cruza el umbral de "alerta" (anti-ruido: relativo al consumo
// reciente, con suelo absoluto — ver migración 20260816T1000).
//
// Decisión de Julio (10/08): Fase B = PERMITIR + AVISAR, nunca bloquear. Este
// servicio es de SOLO LECTURA — no escribe stock, no pone nada a cero.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
}

type Row = Record<string, unknown>

export type NegativeStockCause = 'sin_entradas' | 'compras_por_detras' | 'otras_salidas'

export interface NegativeStockItem {
  recipeItemId: string
  name: string
  unitAbbr: string | null
  qtyOnHand: number        // negativo, en unidad base
  valueEur: number         // negativo
  ratioPct: number | null  // |qty| / consumo de referencia, en %; null = sin consumo de referencia
  cause: NegativeStockCause
  isAlert: boolean         // cruza el umbral anti-ruido (el que cuenta para el badge/lista)
}

export interface NegativeStockReport {
  windowDays: number
  thresholdRelPct: number
  thresholdAbsQty: number
  items: NegativeStockItem[]
}

/**
 * negative_stock_report no está aún en database.ts (migración pendiente de
 * regenerar tipos). CAST PUNTUAL **inline**: el cast y la llamada van en la
 * MISMA expresión — nunca `const rpc = supabase.rpc` suelto, que pierde el
 * `this` de supabase-js y la petición ni se envía ("Cannot read properties of
 * undefined (reading 'rest')"). Ya pasó dos veces en prod (24/07, 26/07);
 * folvy_reglas.md §2.
 */
async function callNegativeStockReport(accountId: string, locationId: string) {
  return (supabase!.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'negative_stock_report', { p_account: accountId, p_location: locationId },
  )
}

export async function getNegativeStockReport(
  accountId: string,
  locationId: string,
): Promise<NegativeStockReport> {
  requireSupabase()
  const { data, error } = await callNegativeStockReport(accountId, locationId)
  if (error) throw new Error(`No se pudo leer el stock negativo: ${error.message}`)
  const o = (data ?? {}) as Row
  const items = ((o.items ?? []) as Row[]).map((r): NegativeStockItem => ({
    recipeItemId: String(r.recipe_item_id),
    name: (r.name as string) ?? '(sin nombre)',
    unitAbbr: (r.unit_abbr as string | null) ?? null,
    qtyOnHand: Number(r.qty_on_hand ?? 0),
    valueEur: Number(r.value_eur ?? 0),
    ratioPct: r.ratio_pct == null ? null : Number(r.ratio_pct),
    cause: ((r.cause as string) ?? 'otras_salidas') as NegativeStockCause,
    isAlert: Boolean(r.is_alert),
  }))
  return {
    windowDays: Number(o.window_days ?? 60),
    thresholdRelPct: Number(o.threshold_rel_pct ?? 5),
    thresholdAbsQty: Number(o.threshold_abs_qty ?? 5),
    items,
  }
}

const CAUSE_LABEL: Record<NegativeStockCause, string> = {
  sin_entradas: 'Sin entradas',
  compras_por_detras: 'Compras por detrás',
  otras_salidas: 'Otras salidas',
}

const CAUSE_EXPLANATION: Record<NegativeStockCause, string> = {
  sin_entradas: 'No hay ninguna recepción cargada para este artículo en este local: elaboración de casa sin producción dada de alta, o compra nunca cargada.',
  compras_por_detras: 'El consumo registrado supera lo comprado cargado. Falta cargar recepciones.',
  otras_salidas: 'No cuadra solo con compras vs consumo: revisa mermas, ajustes o traspasos de este artículo.',
}

const CAUSE_ACTION: Record<NegativeStockCause, string> = {
  sin_entradas: 'Dar de alta la producción o cargar la compra pendiente.',
  compras_por_detras: 'Cargar las recepciones que falten.',
  otras_salidas: 'Revisar mermas, ajustes o traspasos, o hacer un conteo físico.',
}

export function negativeStockCauseLabel(c: NegativeStockCause): string { return CAUSE_LABEL[c] }
export function negativeStockCauseExplanation(c: NegativeStockCause): string { return CAUSE_EXPLANATION[c] }
export function negativeStockCauseAction(c: NegativeStockCause): string { return CAUSE_ACTION[c] }
