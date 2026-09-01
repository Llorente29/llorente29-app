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
  assignedEmployeeId: string | null
  assignedAt: string | null
  scopeAreaIds: string[] | null
  scheduledFor: string | null
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
  // Asignación manual (Vía A: en la cabecera, no en las líneas). El assigned_to
  // por línea es del autoinventario y NO se toca aquí.
  assignedEmployeeId?: string | null
  assignedBy?: string | null
  // Alcance por zonas guardado para el registro / futuro snapshot diferido.
  scopeAreaIds?: string[] | null
  // Día para el que se PROGRAMA (etiqueta + aviso; NO congela stock). El snapshot
  // se congela al Empezar, no al crear.
  scheduledFor?: string | null
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
      assigned_employee_id: input.assignedEmployeeId ?? null,
      assigned_by: input.assignedBy ?? null,
      assigned_at: input.assignedEmployeeId ? new Date().toISOString() : null,
      scope_area_ids: input.scopeAreaIds ?? null,
      scheduled_for: input.scheduledFor ?? null,
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

/**
 * Arranca un conteo PROGRAMADO: genera la hoja y congela el snapshot AHORA
 * (build pone status='contando' + started_at=now()). El alcance sale de
 * scope_area_ids de la cabecera: null/vacío = almacén completo (p_full);
 * con zonas = esas zonas. Devuelve el nº de líneas generadas.
 */
export async function startInventoryCount(countId: string, scopeAreaIds: string[] | null): Promise<number> {
  const hasZones = Array.isArray(scopeAreaIds) && scopeAreaIds.length > 0
  return buildInventoryCount(countId, {
    areaIds: hasZones ? scopeAreaIds : null,
    full: !hasZones,
  })
}

/**
 * Reasigna un inventario manual a otro empleado (solo gestor, guard server-side).
 * Si estaba 'contando', el backend REINICIA (borra la hoja, vuelve a programado)
 * para no mezclar dos manos. Devuelve 'reasignado' | 'reasignado_reiniciado'.
 */
export async function reassignInventoryCount(countId: string, employeeId: string): Promise<string> {
  requireSupabase()
  // reassign_inventory_count es RPC nueva y no está en los tipos generados: se
  // invoca con el cliente sin tipar (mismo patrón que avt_cause_context) para no
  // tocar database.ts.
  const client = supabase! as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{
      data: unknown
      error: { message: string } | null
    }>
  }
  const { data, error } = await client.rpc('reassign_inventory_count', {
    p_count_id: countId,
    p_employee_id: employeeId,
  })
  if (error) throw new Error(`No se pudo reasignar: ${error.message}`)
  return String(data ?? 'reasignado')
}

// ─── Zonas de almacén CON artículos (para el selector de alcance) ───

export interface ZoneOption {
  id: string
  name: string
  parentId: string | null
  itemCount: number
}

/**
 * Zonas del local que TIENEN artículos asignados. El selector de alcance solo
 * debe ofrecer estas: una zona sin artículos generaría un conteo vacío. Si el
 * local no tiene ninguna, el modal fuerza el almacén completo (p_full).
 * Cuenta vía la relación recipe_item_storage_area(count) (mismo patrón probado
 * que inventory_count_line(count)).
 */
export async function listAreasWithItems(_accountId: string, locationId: string): Promise<ZoneOption[]> {
  requireSupabase()
  const { data, error } = await from('storage_area')
    .select('id, name, parent_id, recipe_item_storage_area(count)')
    .eq('location_id', locationId)
    .order('name', { ascending: true })
  if (error) throw new Error(`Error cargando zonas: ${error.message}`)
  return ((data as Row[] | null) ?? [])
    .map(r => {
      const rel = (r.recipe_item_storage_area ?? null) as { count?: number }[] | { count?: number } | null
      const itemCount = Array.isArray(rel) ? (rel[0]?.count ?? 0) : (rel?.count ?? 0)
      return {
        id: r.id as string,
        name: (r.name as string) ?? '(zona)',
        parentId: (r.parent_id as string | null) ?? null,
        itemCount: Number(itemCount),
      }
    })
    .filter(z => z.itemCount > 0)
}

/** Conteos de un local, recientes primero. */
export async function listInventoryCounts(accountId: string, locationId: string): Promise<InventoryCount[]> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .select('id, code, location_id, kind, status, blind, is_opening, assigned_employee_id, assigned_at, scope_area_ids, scheduled_for, started_at, closed_at, approved_at, created_at, inventory_count_line(count)')
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
      assignedEmployeeId: (r.assigned_employee_id as string | null) ?? null,
      assignedAt: (r.assigned_at as string | null) ?? null,
      scopeAreaIds: (r.scope_area_ids as string[] | null) ?? null,
      scheduledFor: (r.scheduled_for as string | null) ?? null,
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
    .select('id, code, location_id, kind, status, blind, is_opening, assigned_employee_id, assigned_at, scope_area_ids, scheduled_for, started_at, closed_at, approved_at, created_at')
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
    assignedEmployeeId: (r.assigned_employee_id as string | null) ?? null,
    assignedAt: (r.assigned_at as string | null) ?? null,
    scopeAreaIds: (r.scope_area_ids as string[] | null) ?? null,
    scheduledFor: (r.scheduled_for as string | null) ?? null,
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

/** El servidor ha rechazado la cantidad por estar fuera de escala (tope de
 *  cordura: >1.000× el teórico, o por encima del tope absoluto si no hay
 *  teórico). No es un fallo: es un dedo gordo probable. Quien cuenta puede
 *  confirmar el valor y volver a guardar. */
export class AbsurdQuantityError extends Error {
  readonly quantity: number
  constructor(message: string, quantity: number) {
    super(message)
    this.name = 'AbsurdQuantityError'
    this.quantity = quantity
  }
}

/** Guarda la cantidad contada de una línea (guardado progresivo).
 *  Sella counted_at (foto por línea: apply ancla el teórico a este instante) y
 *  registra el actor real que tecleó la cantidad.
 *
 *  confirmQty: solo se manda cuando quien cuenta ha confirmado expresamente una
 *  cantidad que el tope de cordura había rechazado. Vale para ESE valor y solo
 *  para ese: el servidor exige que coincida exactamente. */
export async function saveCountedQty(
  lineId: string,
  countedQty: number | null,
  actorId?: string | null,
  actorName?: string | null,
  confirmQty?: number,
): Promise<void> {
  requireSupabase()
  const confirmed = confirmQty !== undefined && confirmQty === countedQty
  const patch: Record<string, unknown> = {
    counted_qty: countedQty,
    counted_at: countedQty === null ? null : new Date().toISOString(),
    // Sin confirmación explícita se limpia: cada cantidad fuera de escala
    // necesita su propia confirmación, nunca hereda la anterior.
    counted_qty_confirmed: confirmed ? countedQty : null,
  }
  if (actorId !== undefined)   patch.counted_by = actorId
  if (actorName !== undefined) patch.counted_by_name = actorName
  const { error } = await from('inventory_count_line')
    .update(patch)
    .eq('id', lineId)
  if (error) {
    // FV001 = tope de cordura del conteo (trg_inventory_count_line_sanity).
    if ((error as { code?: string }).code === 'FV001' && countedQty !== null) {
      throw new AbsurdQuantityError(error.message, countedQty)
    }
    throw new Error(`No se pudo guardar: ${error.message}`)
  }
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

/** Anula un conteo. Solo desde estados editables: nunca un aprobado (eso
 *  dejaría los movimientos de stock aplicados con su documento origen
 *  anulado — corrupción contable silenciosa). Lanza error si no procede. */
export async function voidInventoryCount(countId: string): Promise<void> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .update({
      status: 'anulado',
      updated_at: new Date().toISOString(),
    })
    .eq('id', countId)
    .in('status', ['abierto', 'contando', 'en_revision'])  // nunca un aprobado
    .select('id')
  if (error) throw new Error(`No se pudo anular el conteo: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error('El conteo ya fue aprobado o anulado y no se puede anular.')
  }
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

/** El conteo aprobado inmediatamente ANTERIOR a una fecha (inicio de ventana del AvT puntual). */
export async function getApprovedCountBefore(
  accountId: string,
  locationId: string,
  beforeIso: string,
): Promise<ApprovedCountRef | null> {
  requireSupabase()
  const { data, error } = await from('inventory_count')
    .select('id, code, kind, is_opening, closed_at, approved_at')
    .eq('account_id', accountId)
    .eq('location_id', locationId)
    .eq('status', 'aprobado')
    .lt('closed_at', beforeIso)
    .order('closed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`No se pudo buscar el conteo anterior: ${error.message}`)
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

/**
 * Crudos con consumo infra-contado en [fromIso, toIso) para el local, vía la RPC
 * ÚNICA avt_incomplete_raws (misma verdad que el AvT de periodo). Devuelve un Set
 * de recipe_item_id para mirar pertenencia O(1) por línea del conteo.
 */
export async function getIncompleteConsumptionItems(
  accountId: string,
  locationId: string,
  fromIso: string | null,
  toIso: string | null,
): Promise<Set<string>> {
  requireSupabase()
  // CAST PUNTUAL **inline**: avt_incomplete_raws no está aún en database.ts (CLI
  // de Supabase roto; misma deuda que materialize/duplicate). El cast y la
  // llamada van en la MISMA expresión — nunca `const rpc = supabase.rpc` suelto,
  // que pierde el `this` de supabase-js y la petición ni se envía ("Cannot read
  // properties of undefined (reading 'rest')"). Se retira al regenerar los tipos.
  const { data, error } = await (supabase!.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)('avt_incomplete_raws', {
    p_account: accountId,
    p_from: fromIso,
    p_to: toIso,
    p_location: locationId,
  })
  if (error) throw new Error(`No se pudo calcular el consumo no medible: ${error.message}`)
  const out = new Set<string>()
  for (const row of (data ?? []) as Row[]) {
    const id = row.recipe_item_id as string | null
    if (id) out.add(id)
  }
  return out
}

import {
  PERIODO_VACIO, motivoSinCausa,
  type Cobertura, type CoberturaArticulo, type CoberturaPeriodo,
} from '@/modules/supply/lib/coberturaConsumo'

export interface AvtCause {
  key: 'opening' | 'negative_theoretical' | 'consumo_incompleto' | 'no_recipe' | 'waste' | 'unexplained'
  label: string
}

/**
 * Clasifica la causa de la desviación de una línea (capa 1, heurística sobre los
 * datos de la propia línea; la capa 2 cruzará con stock_waste/escandallo a fondo).
 *   - opening: el conteo es de apertura (no hay desviación que juzgar).
 *   - negative_theoretical: el teórico (system_qty) es < 0 → dato incompleto
 *     (falta registrar compras o el escandallo descuenta de más), no merma real.
 *   - consumo_incompleto: un plato vendido en la ventana tenía una línea de
 *     escandallo en unidad no convertible → su consumo no se descontó → el
 *     teórico de este crudo está inflado y su desviación NO es merma fiable.
 *   - no_recipe: el artículo está needs_review o sin coste → teórico poco fiable.
 *   - waste: hay un motivo de merma declarado en la línea.
 *   - unexplained: desviación genuina sin explicar (candidata a investigar).
 */
export function classifyAvtCause(
  line: InventoryCountLine,
  isOpening: boolean,
  isConsumoIncompleto = false,
): AvtCause {
  if (isOpening) return { key: 'opening', label: 'Apertura' }
  if (line.systemQty !== null && line.systemQty < 0) {
    return { key: 'negative_theoretical', label: 'Dato incompleto' }
  }
  if (isConsumoIncompleto) {
    return { key: 'consumo_incompleto', label: 'Consumo no medible' }
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
// ─── Clasificador de causas NIVEL 2 (cruza con waste, recepciones, escandallo) ───
//
// El nivel 1 (classifyAvtCause) mira solo la línea. Este nivel 2 cruza con los
// datos del periodo para dar causas de COCINA, no de dato:
//   · recepción sin registrar (compra que no entró al sistema)
//   · sobre-porción en elaboración (falta producto sin merma registrada)
//   · merma confirmada (hay registros de waste que la explican)
//   · traspaso no registrado (el producto se fue a otro local)
//
// Doctrina: el clasificador NUNCA miente. Si no hay evidencia suficiente, dice
// "sin causa clara" antes que inventarse un motivo. Cada causa lleva su
// evidencia para que el gestor la juzgue, no la crea a ciegas.

export interface AvtCauseV2 {
  /** Código de motivo alineado con el dropdown de la revisión. */
  reasonCode: string
  /** Etiqueta corta para el chip. */
  label: string
  /** La evidencia legible: por qué el sistema cree esto. */
  evidence: string
  /** Confianza de la propuesta: 'high' la muestra como sugerencia fuerte, 'low' como hipótesis. */
  confidence: 'high' | 'low'
}

export interface CauseContext {
  /** ¿El artículo tuvo mermas registradas (stock_waste) en el periodo? */
  wasteQtyBase: number
  /** ¿El artículo tuvo recepciones (entradas) en el periodo? */
  receiptsQtyBase: number
  /** ¿El artículo tuvo traspasos de salida en el periodo? */
  transfersOutQtyBase: number
  /** ¿El artículo tiene escandallo usado por platos vendidos? */
  usedInRecipes: boolean
  /** ¿El escandallo tiene líneas no convertibles (consumo no medible)? */
  consumoIncompleto: boolean
}

/** Clasifica una desviación cruzando con el contexto del periodo. */
export function classifyCauseV2(
  line: InventoryCountLine,
  isOpening: boolean,
  ctx: CauseContext,
): AvtCauseV2 {
  const variance = (line.countedQty ?? 0) - (line.systemQty ?? 0)
  const shortage = variance < 0   // falta producto
  const surplus = variance > 0    // sobra producto

  // ── Apertura: no hay desviación que juzgar ──
  if (isOpening) {
    return { reasonCode: 'otro', label: 'Apertura', evidence: 'Conteo de apertura: fija el stock inicial, no es desviación.', confidence: 'high' }
  }

  // ── Dato incompleto: teórico negativo (falta registrar compras o escandallo de más) ──
  if (line.systemQty !== null && line.systemQty < 0) {
    return {
      reasonCode: 'error_recepcion',
      label: 'Recepción sin registrar',
      evidence: 'El sistema creía tener menos de cero: faltan compras registradas o el escandallo descuenta de más.',
      confidence: 'high',
    }
  }

  // ── Consumo no medible: escandallo incompleto ──
  if (ctx.consumoIncompleto) {
    return {
      reasonCode: 'error_escandallo',
      label: 'Error de escandallo',
      evidence: 'Un plato vendido usa este artículo con una unidad sin conversión: su consumo no se descontó. La desviación no es merma fiable.',
      confidence: 'high',
    }
  }

  // ── Escandallo no fiable ──
  if (line.needsReview || line.unitCost === null) {
    return {
      reasonCode: 'error_escandallo',
      label: 'Escandallo no fiable',
      evidence: 'El artículo está pendiente de revisar o sin coste: el teórico es poco fiable.',
      confidence: 'high',
    }
  }

  // ── FALTA producto (shortage) ──
  if (shortage) {
    // Merma registrada que la explica (total o parcialmente).
    if (ctx.wasteQtyBase > 0) {
      return {
        reasonCode: 'merma',
        label: 'Merma',
        evidence: `Hay ${fmtQtyHelper(ctx.wasteQtyBase, line.unitAbbr)} de merma registrada en el periodo. La desviación encaja con ella.`,
        confidence: 'high',
      }
    }
    // Se fue a otro local sin registrar.
    if (ctx.transfersOutQtyBase > 0) {
      return {
        reasonCode: 'traspaso',
        label: 'Traspaso no registrado',
        evidence: `Hubo salidas a otro local en el periodo. Probablemente el traspaso no quedó registrado.`,
        confidence: 'low',
      }
    }
    // Sin merma registrada y con escandallo fiable → sobre-porción en elaboración.
    if (ctx.usedInRecipes) {
      return {
        reasonCode: 'merma',
        label: 'Sobre-porción en elaboración',
        evidence: 'Falta producto, no hay merma registrada y el escandallo es fiable: probablemente se sirvió de más al elaborar los platos.',
        confidence: 'low',
      }
    }
    // Robo / desconocido: última hipótesis, con honestidad.
    return {
      reasonCode: 'robo_desconocido',
      label: 'Sin causa clara',
      evidence: 'Falta producto sin merma, traspaso ni consumo de escandallo que lo explique. Requiere revisión manual.',
      confidence: 'low',
    }
  }

  // ── SOBRA producto (surplus) ──
  if (surplus) {
    // Compra recibida que no se registró.
    return {
      reasonCode: 'error_recepcion',
      label: 'Recepción sin registrar',
      evidence: 'Sobra producto: probablemente llegó mercancía que no se registró como recepción.',
      confidence: 'low',
    }
  }

  // Sin desviación.
  return {
    reasonCode: 'otro',
    label: 'Sin desviación',
    evidence: 'El conteo cuadra con el sistema.',
    confidence: 'high',
  }
}

/**
 * ENCARGO 31/08 punto 5 — el motor deja de proponer causas que no puede saber.
 *
 * Regla, en una frase: una causa que se apoya en EVIDENCIA POSITIVA (hay merma
 * registrada, el teórico es negativo, el escandallo está sin revisar) se sostiene
 * sola y pasa. Una causa que se apoya en la AUSENCIA de evidencia —«no hay merma
 * registrada, luego se sirvió de más»— solo vale si de verdad lo hemos medido
 * todo. Esas son exactamente las que el clasificador marca `confidence: 'low'`,
 * así que el filtro no necesita una lista de casos: usa la confianza que el
 * propio clasificador ya declara, y no se queda desactualizado cuando alguien
 * añada una hipótesis nueva.
 *
 * Sin cobertura no se calla la fila (regla 7: el umbral ordena, no esconde): la
 * fila sigue, con su desviación y sus euros. Lo que se sustituye es la CAUSA
 * inventada por el hueco declarado.
 */
export function classifyCauseConCobertura(
  line: InventoryCountLine,
  isOpening: boolean,
  ctx: CauseContext,
  /** `null` = no se pudo medir. NO es sinónimo de "cobertura completa". */
  cobertura: Cobertura | null,
): AvtCauseV2 {
  const base = classifyCauseV2(line, isOpening, ctx)
  if (isOpening) return base
  if (base.confidence !== 'low') return base

  // FALLA CERRADO. Si la cobertura no se pudo medir, `cobertura` es null y NO
  // se propone la hipótesis: no saber si medimos el consumo no es lo mismo que
  // haber medido y salir limpio. El precedente es la propia AvtSection, que se
  // niega a pintar salud "Buena" cuando su RPC de consumo no medible falla.
  const motivo = cobertura === null
    ? 'No puedo atribuirlo: no he podido medir cuánto de lo vendido en este periodo descontó stock.'
    : motivoSinCausa(cobertura.porArticulo.get(line.recipeItemId), cobertura.periodo)
  if (!motivo) return base

  return {
    reasonCode: 'otro',
    label: 'No atribuible',
    evidence: motivo,
    confidence: 'high',   // alta confianza en que NO lo sabemos
  }
}

// helper local (ya existe nf1 arriba; por si no, versión mínima)
function fmtQtyHelper(v: number, unit: string | null): string {
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(v)}${unit ? ` ${unit}` : ''}`
}
// ─── Contexto de causas: llama a la RPC y clasifica cada línea ───

interface CauseContextRow {
  recipe_item_id: string
  waste_qty_base: number
  receipts_qty_base: number
  transfers_out_qty_base: number
  used_in_recipes: boolean
  consumo_incompleto: boolean
}

interface CoverageRow {
  recipe_item_id: string | null
  lineas_tocan: number | null
  lineas_descuentan: number | null
  lineas_vendidas: number | null
  lineas_con_consumo: number | null
  lineas_sin_mapear: number | null
  modif_vendidos: number | null
  modif_sin_vinculo: number | null
  modif_mudos: number | null
}

/**
 * Cobertura real del consumo en la ventana del conteo (ENCARGO 31/08 punto 5).
 * Una fila por artículo contado + UNA fila resumen con recipe_item_id nulo.
 */
export async function getConsumptionCoverage(countId: string): Promise<Cobertura> {
  requireSupabase()
  // Mismo cast puntual inline que el resto de RPCs nuevas: la función no está
  // en database.ts hasta que se regeneren los tipos. Nunca `const rpc =
  // supabase.rpc` suelto — pierde el `this` de supabase-js.
  const { data, error } = await (supabase!.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'avt_consumption_coverage', { p_count_id: countId },
  )
  if (error) throw new Error(`No se pudo medir la cobertura del consumo: ${error.message}`)

  const porArticulo = new Map<string, CoberturaArticulo>()
  let periodo: CoberturaPeriodo = PERIODO_VACIO
  for (const r of (data ?? []) as CoverageRow[]) {
    if (r.recipe_item_id) {
      porArticulo.set(r.recipe_item_id, {
        tocan: Number(r.lineas_tocan ?? 0),
        descuentan: Number(r.lineas_descuentan ?? 0),
      })
    } else {
      periodo = {
        lineasVendidas: Number(r.lineas_vendidas ?? 0),
        lineasConConsumo: Number(r.lineas_con_consumo ?? 0),
        lineasSinMapear: Number(r.lineas_sin_mapear ?? 0),
        modificadores: Number(r.modif_vendidos ?? 0),
        modificadoresSinVinculo: Number(r.modif_sin_vinculo ?? 0),
        modificadoresMudos: Number(r.modif_mudos ?? 0),
      }
    }
  }
  return { periodo, porArticulo }
}

/** Trae el contexto del periodo y clasifica cada línea del conteo (causa V2). */
export async function classifyCountCauses(
  countId: string,
  lines: InventoryCountLine[],
  isOpening: boolean,
  cobertura: Cobertura | null = null,
): Promise<Map<string, AvtCauseV2>> {
  requireSupabase()
  // La RPC es nueva y aún no está en los tipos generados de Supabase: se
  // invoca con el cliente sin tipar para que el compilador no la rechace.
  const client = supabase! as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{
      data: unknown
      error: { message: string } | null
    }>
  }
  const { data, error } = await client.rpc('avt_cause_context', { p_count_id: countId })
  if (error) throw new Error(`No se pudo cargar el contexto de causas: ${error.message}`)

  const ctxByItem = new Map<string, CauseContextRow>()
  for (const r of (data as unknown as CauseContextRow[]) ?? []) {
    ctxByItem.set(r.recipe_item_id, r)
  }

  const result = new Map<string, AvtCauseV2>()
  for (const line of lines) {
    const ctx = ctxByItem.get(line.recipeItemId)
    const context: CauseContext = ctx
      ? {
          wasteQtyBase: Number(ctx.waste_qty_base ?? 0),
          receiptsQtyBase: Number(ctx.receipts_qty_base ?? 0),
          transfersOutQtyBase: Number(ctx.transfers_out_qty_base ?? 0),
          usedInRecipes: Boolean(ctx.used_in_recipes),
          consumoIncompleto: Boolean(ctx.consumo_incompleto),
        }
      : {
          wasteQtyBase: 0,
          receiptsQtyBase: 0,
          transfersOutQtyBase: 0,
          usedInRecipes: false,
          consumoIncompleto: false,
        }
    result.set(line.id, classifyCauseConCobertura(line, isOpening, context, cobertura))
  }
  return result
}
