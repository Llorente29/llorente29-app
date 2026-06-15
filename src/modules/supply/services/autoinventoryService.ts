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
import { getSchedule, listShiftTemplates } from '../../../services/schedulerService'
import { getMondayOfWeek, toISODate, type ScheduleCells } from '../../../types/scheduler'

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

// ─────────────────────────────────────────────────────────────────────
// A3 + A4 — COLA DEL DÍA ASIGNADA POR PERSONA
// Sobre A1/A2 (autoinventory_queue) se materializa la tanda del día por
// frescura hasta cobertura (RPC generate_daily_count), repartida entre quienes
// trabajan hoy. QUIÉN = horario planificado (como APPCC v2), no fichaje.
// El admin enciende/apaga el autoinventario y fija el tope por persona.
// ─────────────────────────────────────────────────────────────────────


export interface AutoinventorySettings {
  enabled: boolean
  perPerson: number
}

// Lee los ajustes de autoinventario de la cuenta (supply_settings). Si no hay
// fila aún, defaults: encendido, 8 por persona (la mayoría lo quiere).
export async function getAutoinventorySettings(accountId: string): Promise<AutoinventorySettings> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('supply_settings')
    .select('autoinventory_enabled, autoinventory_per_person')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw new Error(`No se pudieron leer los ajustes: ${error.message}`)
  return {
    enabled: data?.autoinventory_enabled ?? true,
    perPerson: Number(data?.autoinventory_per_person ?? 8),
  }
}

// Activa/desactiva el autoinventario para la cuenta (upsert por account_id).
export async function setAutoinventoryEnabled(accountId: string, enabled: boolean): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('supply_settings')
    .upsert({ account_id: accountId, autoinventory_enabled: enabled }, { onConflict: 'account_id' })
  if (error) throw new Error(`No se pudo guardar el ajuste: ${error.message}`)
}

// Quién trabaja HOY en el local: horario planificado (cuadrante de la semana +
// plantillas de turno) menos vacaciones aprobadas. Mismo criterio que APPCC v2
// (el cuadrante es mejor señal que el fichaje: a primera hora aún nadie ha
// fichado pero el horario ya sabe quién entra). Si el local NO tiene cuadrante,
// FALLBACK: empleados activos del local (mejor repartir entre todos que no
// generar nada). Si tampoco hay → [] (la cola nace sin asignar, el gestor reparte).
export async function resolveTodayCounters(locationId: string, dateISO: string): Promise<string[]> {
  if (!supabase) return []
  const sb = supabase

  const monday = toISODate(getMondayOfWeek(new Date(dateISO + 'T00:00:00')))
  const [schedule, shiftTemplates] = await Promise.all([
    getSchedule(locationId, monday),
    listShiftTemplates(locationId),
  ])

  const working = new Set<string>()
  if (schedule?.cells) {
    const jsDay = new Date(dateISO + 'T00:00:00').getDay() // 0=dom..6=sáb
    const dayKey = String((jsDay + 6) % 7)                 // 0=lunes..6=domingo
    const validTpl = new Set(shiftTemplates.map((t) => t.id))
    const cells = schedule.cells as ScheduleCells
    for (const tplId of Object.keys(cells)) {
      if (!validTpl.has(tplId)) continue
      for (const id of cells[tplId]?.[dayKey] || []) working.add(id)
    }
  }

  let ids = Array.from(working)

  // Fallback: sin cuadrante → empleados activos del local.
  if (ids.length === 0) {
    const { data: emps } = await sb
      .from('employees')
      .select('id')
      .eq('active', true)
      .eq('location_id', locationId)
    ids = (emps ?? []).map((e: { id: string }) => e.id)
    if (ids.length === 0) return []
  }

  // Quitar vacaciones/permiso aprobado que cubran hoy.
  const { data: vac } = await sb
    .from('vacations')
    .select('employee_id')
    .eq('status', 'aprobada')
    .in('employee_id', ids)
    .lte('start_date', dateISO)
    .gte('end_date', dateISO)
  const onVac = new Set((vac ?? []).map((v: { employee_id: string }) => v.employee_id))
  return ids.filter((id) => !onVac.has(id))
}

export interface DailyCountResult {
  countId: string
  linesCreated: number
  alreadyExisted: boolean
  /** Cobertura fresca del valor ANTES de la cola de hoy (%). null si ya existía. */
  coverageBefore: number | null
  /** Cobertura fresca tras añadir la cola de hoy (%). null si ya existía. */
  coverageAfter: number | null
  /** Cupo por persona aplicado hoy (adaptativo según frescura). null si ya existía. */
  perPersonToday: number | null
}

// Genera (idempotente) la cola del día y la reparte por persona. Respeta el
// flag de la cuenta: si el autoinventario está APAGADO, no genera nada (null).
// Sirve tanto a la generación automática (al abrir la app) como al botón manual.
export async function generateDailyCount(
  accountId: string,
  locationId: string,
  dateISO?: string,
): Promise<DailyCountResult | null> {
  requireSupabase()
  const settings = await getAutoinventorySettings(accountId)
  if (!settings.enabled) return null

  const day = dateISO ?? toISODate(new Date())
  const counters = await resolveTodayCounters(locationId, day)

  const { data, error } = await supabase!.rpc('generate_daily_count', {
    p_account_id: accountId,
    p_location_id: locationId,
    p_employee_ids: counters.length > 0 ? counters : undefined,
    p_per_person: settings.perPerson,
    p_coverage_target: 80,
  })
  if (error) throw new Error(`No se pudo generar la cola del día: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return {
    countId: r?.count_id as string,
    linesCreated: Number(r?.lines_created ?? 0),
    alreadyExisted: Boolean(r?.already_existed),
    coverageBefore: r?.coverage_before == null ? null : Number(r.coverage_before),
    coverageAfter: r?.coverage_after == null ? null : Number(r.coverage_after),
    perPersonToday: r?.per_person_today == null ? null : Number(r.per_person_today),
  }
}

export interface DailyQueueLine {
  lineId: string
  recipeItemId: string
  name: string
  baseUnit: string | null
  countedQty: number | null
  /** snapshot del sistema — NO se muestra al trabajador (blind); sirve solo para el aviso de variación. */
  systemQty: number | null
  abcClass: 'A' | 'B' | 'C' | null
  position: number
}

// "Mi cola de hoy" para el trabajador: las líneas del conteo cycle de hoy
// asignadas a ese empleado, en orden. Devuelve también el countId.
export async function getMyDailyQueue(
  locationId: string,
  employeeId: string,
  dateISO?: string,
): Promise<{ countId: string | null; lines: DailyQueueLine[] }> {
  requireSupabase()
  const day = dateISO ?? toISODate(new Date())
  const { data: counts } = await supabase!
    .from('inventory_count')
    .select('id, created_at')
    .eq('location_id', locationId)
    .eq('kind', 'cycle')
    .neq('status', 'anulado')
    .gte('created_at', day + 'T00:00:00')
    .order('created_at', { ascending: false })
    .limit(1)
  const countId = counts?.[0]?.id as string | undefined
  if (!countId) return { countId: null, lines: [] }

  const { data, error } = await supabase!
    .from('inventory_count_line')
    .select('id, recipe_item_id, counted_qty, system_qty, abc_class, position, recipe_item(name, base_unit_id, kitchen_unit:base_unit_id(abbreviation))')
    .eq('inventory_count_id', countId)
    .eq('assigned_to', employeeId)
    .order('position', { ascending: true })
  if (error) throw new Error(`No se pudo cargar la cola: ${error.message}`)

  const lines: DailyQueueLine[] = ((data as Row[] | null) ?? []).map((r) => {
    const ri = (r.recipe_item ?? {}) as Record<string, unknown>
    const ku = (ri.kitchen_unit ?? {}) as Record<string, unknown>
    return {
      lineId: r.id as string,
      recipeItemId: r.recipe_item_id as string,
      name: (ri.name as string) ?? '(sin nombre)',
      baseUnit: (ku.abbreviation as string | null) ?? null,
      countedQty: r.counted_qty == null ? null : Number(r.counted_qty),
      systemQty: r.system_qty == null ? null : Number(r.system_qty),
      abcClass: (r.abc_class as 'A' | 'B' | 'C' | null) ?? null,
      position: Number(r.position ?? 0),
    }
  })
  return { countId, lines }
}

// Veredicto de variación para el aviso al trabajador (paso 3 del wizard móvil).
// El servidor compara lo tecleado contra el system_qty SIN exponerlo (blind):
// 'ok' | 'low' (mucho menos) | 'high' (mucho más). Banda ancha (1/3 ó 3x):
// caza errores de magnitud (un cero de más/menos), no la deriva normal.
export async function checkCountVariance(
  lineId: string,
  counted: number,
): Promise<'ok' | 'low' | 'high'> {
  requireSupabase()
  const { data, error } = await supabase!.rpc('check_count_variance', {
    p_line_id: lineId,
    p_counted: counted,
  })
  if (error) throw new Error(`No se pudo comprobar la variación: ${error.message}`)
  const v = String(data ?? 'ok')
  return v === 'low' || v === 'high' ? v : 'ok'
}
