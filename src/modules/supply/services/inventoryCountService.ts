// src/modules/supply/services/inventoryCountService.ts
//
// Conteo de inventario (capa 1.3). Crear conteo, generar su hoja (build),
// cargar líneas para contar a ciegas, guardar lo contado, y cerrar (calcula
// variación vs tolerancia ABC). NO escribe ajustes — eso es 1.4 (al aprobar).
//
// El local NO se elige: viene del local operativo (useOperativeLocation).
//
// T1 (apertura): un conteo puede ser de APERTURA (is_opening). Lo decide el
// backend al generar la hoja: es apertura si el local no tiene aún ningún
// movimiento 'apertura'. Al aprobarlo, ancla el stock inicial (no es merma);
// el AvT excluirá esos movimientos del cómputo de variación.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

type Row = Record<string, unknown>

function from(table: string) {
  return (supabase! as unknown as {
    from: (t: string) => ReturnType<NonNullable<typeof supabase>['from']>
  }).from(table)
}

export type InventoryCountKind = 'cycle' | 'audit' | 'full'
export type InventoryCountStatus = 'abierto' | 'contando' | 'en_revision' | 'aprobado' | 'anulado'

export interface InventoryCount {
  id: string
  code: string | null
  locationId: string
  kind: InventoryCountKind
  status: InventoryCountStatus
  blind: boolean
  isOpening: boolean
  startedAt: string | null
  closedAt: string | null
  approvedAt: string | null
  createdAt: string
  lineCount?: number
}

export interface InventoryCountLine {
  id: string
  recipeItemId: string
  itemName: string
  unitAbbr: string | null
  storageAreaId: string | null
  storageAreaName: string | null
  position: number
  systemQty: number | null
  countedQty: number | null
  varianceQty: number | null
  variancePct: number | null
  varianceValue: number | null
  abcClass: 'A' | 'B' | 'C' | null
  withinTolerance: boolean | null
  reasonCode: string | null
  // Coste/familia del artículo (para € por línea y filtro por familia).
  unitCost: number | null          // computed_cost: coste por unidad base (€/unidad base)
  familyId: string | null
  familyName: string | null
  needsReview: boolean             // recipe_item.needs_review (pendiente de revisar)
  lineValue: number | null         // counted_qty × unitCost (€), null si falta alguno
}

export interface InventoryCountSummary {
  total: number
  counted: number
  ok: number
  out: number
  uncounted: number
  totalVarianceValue: number
}

// ─── Crear / listar conteos ───

/** Crea un conteo (cabecera). El código INV- lo asigna el trigger. */
export async function createInventoryCount(input: {
  accountId: string
  locationId: string
  kind: InventoryCountKind
  blind?: boolean
  createdBy?: string | null
  createdByName?: string | null
}): Promise<string> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      kind: input.kind,
      blind: input.blind ?? true,
      status: 'abierto',
      created_by: input.createdBy ?? null,
      created_by_name: input.createdByName ?? null,
      started_by: input.createdBy ?? null,
      started_by_name: input.createdByName ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(`No se pudo crear el conteo: ${error.message}`)
  return (data as Row).id as string
}

/** Genera las líneas del conteo (build_inventory_count). Devuelve nº de líneas. */
export async function buildInventoryCount(
  countId: string,
  opts: { areaIds?: string[] | null; full?: boolean },
): Promise<number> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('build_inventory_count', {
    p_count_id: countId,
    p_area_ids: opts.areaIds ?? undefined,
    p_full: opts.full ?? false,
  })
  if (error) throw new Error(`No se pudo generar la hoja de conteo: ${error.message}`)
  return Number(data ?? 0)
}

/** Conteos de un local, recientes primero. */
export async function listInventoryCounts(accountId: string, locationId: string): Promise<InventoryCount[]> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .select('id, code, location_id, kind, status, blind, is_opening, started_at, closed_at, approved_at, created_at, inventory_count_line(count)')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Error cargando conteos: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => {
    const rel = (r.inventory_count_line ?? null) as { count?: number }[] | { count?: number } | null
    const count = Array.isArray(rel) ? (rel[0]?.count ?? 0) : (rel?.count ?? 0)
    return {
      id: r.id as string,
      code: (r.code as string | null) ?? null,
      locationId: r.location_id as string,
      kind: (r.kind as InventoryCountKind) ?? 'cycle',
      status: (r.status as InventoryCountStatus) ?? 'abierto',
      blind: Boolean(r.blind),
      isOpening: Boolean(r.is_opening),
      startedAt: (r.started_at as string | null) ?? null,
      closedAt: (r.closed_at as string | null) ?? null,
      approvedAt: (r.approved_at as string | null) ?? null,
      createdAt: r.created_at as string,
      lineCount: Number(count),
    }
  })
}

export async function getInventoryCount(countId: string): Promise<InventoryCount | null> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .select('id, code, location_id, kind, status, blind, is_opening, started_at, closed_at, approved_at, created_at')
    .eq('id', countId)
    .maybeSingle()
  if (error) throw new Error(`Error cargando el conteo: ${error.message}`)
  if (!data) return null
  const r = data as Row
  return {
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    locationId: r.location_id as string,
    kind: (r.kind as InventoryCountKind) ?? 'cycle',
    status: (r.status as InventoryCountStatus) ?? 'abierto',
    blind: Boolean(r.blind),
    isOpening: Boolean(r.is_opening),
    startedAt: (r.started_at as string | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    createdAt: r.created_at as string,
  }
}

/** Líneas del conteo, ordenadas por área+posición (shelf-to-sheet). */
export async function listCountLines(countId: string): Promise<InventoryCountLine[]> {
  requireSupabase()
  const { data, error } = await from('inventory_count_line')
    .select(`
      id, recipe_item_id, storage_area_id, position, system_qty, counted_qty,
      variance_qty, variance_pct, variance_value, abc_class, within_tolerance, reason_code,
      recipe_item:recipe_item_id (
        name, computed_cost, family_id, needs_review,
        kitchen_unit:base_unit_id ( abbreviation ),
        recipe_family:family_id ( name )
      ),
      storage_area:storage_area_id ( name )
    `)
    .eq('inventory_count_id', countId)
    .order('position', { ascending: true })
  if (error) throw new Error(`Error cargando las líneas: ${error.message}`)
  return ((data as Row[] | null) ?? []).map(r => {
    const item = (r.recipe_item ?? null) as {
      name?: string
      computed_cost?: number | null
      family_id?: string | null
      needs_review?: boolean | null
      kitchen_unit?: { abbreviation?: string } | null
      recipe_family?: { name?: string } | null
    } | null
    const area = (r.storage_area ?? null) as { name?: string } | null
    const countedQty = (r.counted_qty as number | null) ?? null
    const unitCost = (item?.computed_cost as number | null) ?? null
    const lineValue = (countedQty !== null && unitCost !== null) ? countedQty * unitCost : null
    return {
      id: r.id as string,
      recipeItemId: r.recipe_item_id as string,
      itemName: item?.name ?? '(sin nombre)',
      unitAbbr: item?.kitchen_unit?.abbreviation ?? null,
      storageAreaId: (r.storage_area_id as string | null) ?? null,
      storageAreaName: area?.name ?? null,
      position: Number(r.position ?? 0),
      systemQty: (r.system_qty as number | null) ?? null,
      countedQty,
      varianceQty: (r.variance_qty as number | null) ?? null,
      variancePct: (r.variance_pct as number | null) ?? null,
      varianceValue: (r.variance_value as number | null) ?? null,
      abcClass: (r.abc_class as 'A' | 'B' | 'C' | null) ?? null,
      withinTolerance: (r.within_tolerance as boolean | null) ?? null,
      reasonCode: (r.reason_code as string | null) ?? null,
      unitCost,
      familyId: (item?.family_id as string | null) ?? null,
      familyName: item?.recipe_family?.name ?? null,
      needsReview: Boolean(item?.needs_review),
      lineValue,
    }
  })
}

/** Guarda la cantidad contada de una línea (guardado progresivo). */
export async function saveCountedQty(lineId: string, countedQty: number | null): Promise<void> {
  requireSupabase()
  const { error } = await from('inventory_count_line')
    .update({ counted_qty: countedQty })
    .eq('id', lineId)
  if (error) throw new Error(`No se pudo guardar: ${error.message}`)
}

/** Guarda el motivo (reason_code) de una línea fuera de tolerancia. */
export async function saveReasonCode(lineId: string, reasonCode: string | null): Promise<void> {
  requireSupabase()
  const { error } = await from('inventory_count_line')
    .update({ reason_code: reasonCode })
    .eq('id', lineId)
  if (error) throw new Error(`No se pudo guardar el motivo: ${error.message}`)
}

/** Cierra el conteo: calcula variación vs tolerancia. Devuelve resumen. */
export async function closeInventoryCount(countId: string): Promise<InventoryCountSummary> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('close_inventory_count', { p_count_id: countId })
  if (error) throw new Error(`No se pudo cerrar el conteo: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Row | null
  return {
    total: Number(r?.lines_total ?? 0),
    counted: Number(r?.lines_counted ?? 0),
    ok: Number(r?.lines_ok ?? 0),
    out: Number(r?.lines_out ?? 0),
    uncounted: Number(r?.lines_uncounted ?? 0),
    totalVarianceValue: Number(r?.total_variance_value ?? 0),
  }
}

/** Anula un conteo (no se borra; queda como anulado). */
export async function voidInventoryCount(countId: string): Promise<void> {
  requireSupabase()
  const { error } = await from('inventory_count')
    .update({ status: 'anulado', updated_at: new Date().toISOString() })
    .eq('id', countId)
  if (error) throw new Error(`No se pudo anular: ${error.message}`)
}

export interface ApplyCountResult {
  adjustments: number
  itemsRecomputed: number
}

/**
 * Aprueba el conteo: escribe los movimientos en el ledger y recalcula el saldo.
 * Si el conteo es de APERTURA, los escribe como 'apertura' (ancla el stock
 * inicial, no es merma); si no, como 'ajuste' (variación). Cierra la capa 1.
 * Lanza error si hay líneas fuera de tolerancia sin motivo.
 */
export async function approveInventoryCount(
  countId: string,
  userId?: string | null,
  userName?: string | null,
): Promise<ApplyCountResult> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('apply_inventory_count', {
    p_count_id: countId,
    p_user_id: userId ?? undefined,
    p_user_name: userName ?? undefined,
  })
  if (error) throw new Error(error.message)
  const r = (Array.isArray(data) ? data[0] : data) as Row | null
  return {
    adjustments: Number(r?.adjustments ?? 0),
    itemsRecomputed: Number(r?.items_recomputed ?? 0),
  }
}

export const REASON_CODES: { value: string; label: string }[] = [
  { value: 'merma', label: 'Merma' },
  { value: 'caducado', label: 'Caducado' },
  { value: 'rotura', label: 'Rotura' },
  { value: 'robo_desconocido', label: 'Robo / desconocido' },
  { value: 'error_escandallo', label: 'Error de escandallo' },
  { value: 'error_recepcion', label: 'Error de recepción' },
  { value: 'traspaso', label: 'Traspaso no registrado' },
  { value: 'otro', label: 'Otro' },
]

// ─── Inspector de revisión (IA): propone motivo de variación ───
// Para las líneas fuera de tolerancia, la IA propone el reason_code más probable
// con confianza y explicación. NO auto-aplica: el front muestra la sugerencia y
// el responsable la confirma con un clic. "IA propone, humano decide".
export interface CountReasonSuggestion {
  id: string            // inventory_count_line.id
  reasonCode: string    // uno de REASON_CODES
  confidence: number    // 0..1
  explanation: string
}

export interface CountReasonLineInput {
  id: string
  itemName: string
  familyName: string | null
  abcClass: string | null
  varianceQty: number | null
  variancePct: number | null
  varianceValue: number | null
  unitAbbr: string | null
}

export async function proposeCountReasons(
  lines: CountReasonLineInput[],
): Promise<CountReasonSuggestion[]> {
  requireSupabase()
  const { data, error } = await supabase!.functions.invoke('propose-count-reasons', {
    body: { lines },
  })
  if (error) throw new Error(`No se pudieron sugerir motivos: ${error.message}`)
  const arr = ((data as { suggestions?: unknown[] } | null)?.suggestions ?? []) as Array<Record<string, unknown>>
  return arr.map((s) => ({
    id: String(s.id ?? ''),
    reasonCode: String(s.reasonCode ?? 'otro'),
    confidence: Number(s.confidence ?? 0),
    explanation: String(s.explanation ?? ''),
  }))
}

// ─────────────────────────────────────────────────────────────────────
// AvT capa 1 — Último conteo APROBADO del local (el "Real" más reciente).
// El AvT puntual lee ese conteo: system_qty (teórico en el instante) vs
// counted_qty (real) vs variance_value (€), ya calculados al cerrar.
// ─────────────────────────────────────────────────────────────────────

export interface ApprovedCountRef {
  id: string
  code: string | null
  kind: InventoryCountKind
  isOpening: boolean
  closedAt: string | null
  approvedAt: string | null
}

/** El conteo aprobado más reciente del local (o null si no hay ninguno). */
export async function getLatestApprovedCount(
  accountId: string,
  locationId: string,
): Promise<ApprovedCountRef | null> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .select('id, code, kind, is_opening, closed_at, approved_at')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .eq('status', 'aprobado')
    .order('approved_at', { ascending: false, nullsFirst: false })
    .order('closed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`No se pudo buscar el último conteo: ${error.message}`)
  if (!data) return null
  const r = data as Row
  return {
    id: r.id as string,
    code: (r.code as string | null) ?? null,
    kind: (r.kind as InventoryCountKind) ?? 'cycle',
    isOpening: Boolean(r.is_opening),
    closedAt: (r.closed_at as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
  }
}

export interface AvtCause {
  key: 'opening' | 'negative_theoretical' | 'no_recipe' | 'waste' | 'unexplained'
  label: string
}

/**
 * Clasifica la causa de la desviación de una línea (capa 1, heurística sobre los
 * datos de la propia línea; la capa 2 cruzará con stock_waste/escandallo a fondo).
 *   - opening: el conteo es de apertura (no hay desviación que juzgar).
 *   - negative_theoretical: el teórico (system_qty) es < 0 → dato incompleto
 *     (falta registrar compras o el escandallo descuenta de más), no merma real.
 *   - no_recipe: el artículo está needs_review o sin coste → teórico poco fiable.
 *   - waste: hay un motivo de merma declarado en la línea.
 *   - unexplained: desviación genuina sin explicar (candidata a investigar).
 */
export function classifyAvtCause(line: InventoryCountLine, isOpening: boolean): AvtCause {
  if (isOpening) return { key: 'opening', label: 'Apertura' }
  if (line.systemQty !== null && line.systemQty < 0) {
    return { key: 'negative_theoretical', label: 'Dato incompleto' }
  }
  if (line.needsReview || line.unitCost === null) {
    return { key: 'no_recipe', label: 'Escandallo no fiable' }
  }
  if (line.reasonCode && ['merma', 'caducado', 'rotura'].includes(line.reasonCode)) {
    return { key: 'waste', label: 'Merma real' }
  }
  return { key: 'unexplained', label: 'Sin clasificar' }
}

export interface AvtDataHealth {
  hasCount: boolean
  countCode: string | null
  countDate: string | null
  isOpening: boolean
  coveredItems: number          // líneas con counted_qty no nulo
  negativeTheoretical: number   // líneas con system_qty < 0 (dato incompleto)
  noRecipe: number              // líneas needs_review o sin coste
  level: 'none' | 'partial' | 'good'
}
