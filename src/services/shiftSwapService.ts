// src/services/shiftSwapService.ts
// CRUD y flujo de estados para cambios de turno entre empleados.
// Incluye aplicar el cambio al schedule cuando el gestor aprueba.

import { supabase } from '../lib/supabase'
import type {
  ShiftSwapRequest,
  SwapType,
  SwapStatus,
  HoursAttribution,
} from '../types/shiftSwap'
import type { Schedule, ScheduleCells } from '../types/scheduler'
import { createNotification } from './notificationsService'

interface ShiftSwapRow {
  id: string
  swap_type: string
  requester_id: string
  requester_schedule_id: string
  requester_template_id: string
  requester_day_key: string
  requester_date: string
  target_id: string | null
  target_schedule_id: string | null
  target_template_id: string | null
  target_day_key: string | null
  target_date: string | null
  status: string
  request_notes: string | null
  acceptor_notes: string | null
  manager_notes: string | null
  reviewed_by: string | null
  hours_attribution: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
}

function rowToSwap(r: ShiftSwapRow): ShiftSwapRequest {
  return {
    id: r.id,
    swapType: r.swap_type as SwapType,
    requesterId: r.requester_id,
    requesterScheduleId: r.requester_schedule_id,
    requesterTemplateId: r.requester_template_id,
    requesterDayKey: r.requester_day_key,
    requesterDate: r.requester_date,
    targetId: r.target_id || undefined,
    targetScheduleId: r.target_schedule_id || undefined,
    targetTemplateId: r.target_template_id || undefined,
    targetDayKey: r.target_day_key || undefined,
    targetDate: r.target_date || undefined,
    status: r.status as SwapStatus,
    requestNotes: r.request_notes || undefined,
    acceptorNotes: r.acceptor_notes || undefined,
    managerNotes: r.manager_notes || undefined,
    reviewedBy: r.reviewed_by || undefined,
    hoursAttribution: (r.hours_attribution as HoursAttribution) || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    reviewedAt: r.reviewed_at || undefined,
  }
}

/* =====================================================
   CREAR SOLICITUDES
   ===================================================== */

/**
 * Cesión simple: A libra su turno para que cualquiera lo coja.
 * Status inicial: 'abierta'
 */
export async function createCesionRequest(
  requesterId: string,
  scheduleId: string,
  templateId: string,
  dayKey: string,
  date: string,
  notes?: string
): Promise<ShiftSwapRequest | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('shift_swap_requests')
    .insert({
      swap_type: 'cesion',
      requester_id: requesterId,
      requester_schedule_id: scheduleId,
      requester_template_id: templateId,
      requester_day_key: dayKey,
      requester_date: date,
      status: 'abierta',
      request_notes: notes || null,
    })
    .select()
    .single()
  if (error) {
    console.error('[shiftSwap] createCesionRequest:', error)
    return null
  }
  return rowToSwap(data as ShiftSwapRow)
}

/**
 * Intercambio: A propone cambiar SU turno por OTRO turno específico de B.
 * Status inicial: 'propuesta' (B y el gestor verán la propuesta).
 */
export async function createIntercambioRequest(
  requesterId: string,
  requester: { scheduleId: string; templateId: string; dayKey: string; date: string },
  targetEmployeeId: string,
  target: { scheduleId: string; templateId: string; dayKey: string; date: string },
  notes?: string
): Promise<ShiftSwapRequest | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('shift_swap_requests')
    .insert({
      swap_type: 'intercambio',
      requester_id: requesterId,
      requester_schedule_id: requester.scheduleId,
      requester_template_id: requester.templateId,
      requester_day_key: requester.dayKey,
      requester_date: requester.date,
      target_id: targetEmployeeId,
      target_schedule_id: target.scheduleId,
      target_template_id: target.templateId,
      target_day_key: target.dayKey,
      target_date: target.date,
      status: 'propuesta',
      request_notes: notes || null,
    })
    .select()
    .single()
  if (error) {
    console.error('[shiftSwap] createIntercambioRequest:', error)
    return null
  }
  const swap = rowToSwap(data as ShiftSwapRow)
  // Notificar al target
  notifyTarget(swap, 'incoming_swap_request')
  return swap
}

/**
 * Petición directa: A pide a B concreto que coja su turno (sin contrapartida).
 * Status inicial: 'propuesta' (B verá la solicitud directamente).
 */
export async function createPeticionDirectaRequest(
  requesterId: string,
  scheduleId: string,
  templateId: string,
  dayKey: string,
  date: string,
  targetEmployeeId: string,
  notes?: string
): Promise<ShiftSwapRequest | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('shift_swap_requests')
    .insert({
      swap_type: 'peticion_directa',
      requester_id: requesterId,
      requester_schedule_id: scheduleId,
      requester_template_id: templateId,
      requester_day_key: dayKey,
      requester_date: date,
      target_id: targetEmployeeId,
      status: 'propuesta',
      request_notes: notes || null,
    })
    .select()
    .single()
  if (error) {
    console.error('[shiftSwap] createPeticionDirectaRequest:', error)
    return null
  }
  const swap = rowToSwap(data as ShiftSwapRow)
  notifyTarget(swap, 'incoming_swap_request')
  return swap
}

/* =====================================================
   ACEPTAR (cuando alguien coge una cesión abierta)
   ===================================================== */

/**
 * Empleado B coge una cesión abierta. La solicitud pasa a 'propuesta' y queda
 * pendiente de aprobación del gestor.
 */
export async function acceptCesion(
  swapId: string,
  acceptorId: string,
  acceptorNotes?: string
): Promise<boolean> {
  if (!supabase) return false
  const { data: swap, error: getErr } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .eq('id', swapId)
    .eq('status', 'abierta')
    .eq('swap_type', 'cesion')
    .maybeSingle()
  if (getErr || !swap) {
    console.error('[shiftSwap] acceptCesion: solicitud no disponible', getErr)
    return false
  }
  const { error } = await supabase
    .from('shift_swap_requests')
    .update({
      target_id: acceptorId,
      acceptor_notes: acceptorNotes || null,
      status: 'propuesta',
    })
    .eq('id', swapId)
  if (error) {
    console.error('[shiftSwap] acceptCesion:', error)
    return false
  }
  return true
}

/**
 * Empleado B acepta una petición directa que recibió (en cesión sería acceptCesion).
 * Para intercambio o peticion_directa que ya están en 'propuesta', el aceptar
 * conceptual (B acepta) NO cambia el estado: ya está pendiente del gestor.
 *
 * Esta función la dejo por si en el futuro queremos un paso intermedio
 * "B confirma → gestor aprueba". De momento devuelve simplemente true para
 * mantener API consistente.
 */
export async function confirmTargetAccepts(
  _swapId: string,
  _notes?: string
): Promise<boolean> {
  return true
}

/* =====================================================
   APROBAR / RECHAZAR (gestor)
   ===================================================== */

/**
 * Gestor aprueba un cambio. Aplica los movimientos al/los schedules
 * correspondientes y marca la solicitud como 'aprobada'.
 *
 * @param hoursAttribution - 'worker' (default, legal): quien trabaja cobra.
 *                           'requester': se imputan al cedente original (acuerdo excepcional).
 */
export async function approveSwap(
  swapId: string,
  managerEmployeeId: string,
  managerNotes?: string,
  hoursAttribution: HoursAttribution = 'worker'
): Promise<boolean> {
  if (!supabase) return false

  // Cargar solicitud
  const { data: row, error: getErr } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .eq('id', swapId)
    .eq('status', 'propuesta')
    .maybeSingle()
  if (getErr || !row) {
    console.error('[shiftSwap] approveSwap: solicitud no encontrada o no en propuesta', getErr)
    return false
  }
  const swap = rowToSwap(row as ShiftSwapRow)
  if (!swap.targetId) {
    console.error('[shiftSwap] approveSwap: sin target_id, no se puede aplicar')
    return false
  }

  // Aplicar el movimiento al schedule (siempre, refleja la realidad física)
  const applied = await applySwapToSchedule(swap)
  if (!applied) {
    console.error('[shiftSwap] approveSwap: error aplicando al schedule')
    return false
  }

  // Marcar como aprobada con la atribución de horas
  const { error } = await supabase
    .from('shift_swap_requests')
    .update({
      status: 'aprobada',
      manager_notes: managerNotes || null,
      reviewed_by: managerEmployeeId,
      reviewed_at: new Date().toISOString(),
      hours_attribution: hoursAttribution,
    })
    .eq('id', swapId)
  if (error) {
    console.error('[shiftSwap] approveSwap:', error)
    return false
  }

  // Notificar a ambos empleados
  notifySwapResolved(swap, 'aprobada')
  return true
}

/**
 * Gestor rechaza un cambio.
 */
export async function rejectSwap(
  swapId: string,
  managerEmployeeId: string,
  managerNotes?: string
): Promise<boolean> {
  if (!supabase) return false
  const { data: row, error: getErr } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .eq('id', swapId)
    .eq('status', 'propuesta')
    .maybeSingle()
  if (getErr || !row) {
    console.error('[shiftSwap] rejectSwap: solicitud no encontrada')
    return false
  }
  const swap = rowToSwap(row as ShiftSwapRow)

  const { error } = await supabase
    .from('shift_swap_requests')
    .update({
      status: 'rechazada',
      manager_notes: managerNotes || null,
      reviewed_by: managerEmployeeId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', swapId)
  if (error) {
    console.error('[shiftSwap] rejectSwap:', error)
    return false
  }
  notifySwapResolved(swap, 'rechazada')
  return true
}

/* =====================================================
   CANCELAR (solicitante)
   ===================================================== */

/**
 * El solicitante cancela su solicitud. Solo válido si está en 'abierta' o 'propuesta'.
 */
export async function cancelSwap(swapId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('shift_swap_requests')
    .update({ status: 'cancelada' })
    .eq('id', swapId)
    .in('status', ['abierta', 'propuesta'])
  if (error) {
    console.error('[shiftSwap] cancelSwap:', error)
    return false
  }
  return true
}

/* =====================================================
   LISTADOS
   ===================================================== */

/**
 * Listar TODAS las solicitudes (gestor).
 * Por defecto las más recientes primero.
 */
export async function listAllSwaps(options?: {
  status?: SwapStatus | SwapStatus[]
  limit?: number
}): Promise<ShiftSwapRequest[]> {
  if (!supabase) return []
  let q = supabase
    .from('shift_swap_requests')
    .select('*')
    .order('created_at', { ascending: false })
  if (options?.limit) q = q.limit(options.limit)
  if (options?.status) {
    if (Array.isArray(options.status)) {
      q = q.in('status', options.status)
    } else {
      q = q.eq('status', options.status)
    }
  }
  const { data, error } = await q
  if (error) {
    console.error('[shiftSwap] listAllSwaps:', error)
    return []
  }
  return (data || []).map(r => rowToSwap(r as ShiftSwapRow))
}

/**
 * Listar solicitudes pendientes para el gestor (status='propuesta').
 */
export async function listPendingForManager(): Promise<ShiftSwapRequest[]> {
  return listAllSwaps({ status: 'propuesta' })
}

/**
 * Listar cesiones abiertas (tablón de cambios disponibles).
 */
export async function listOpenCesiones(): Promise<ShiftSwapRequest[]> {
  return listAllSwaps({ status: 'abierta' })
}

/**
 * Listar todas las solicitudes que afectan a un empleado:
 * - las que ÉL solicitó
 * - las que le piden a ÉL (target_id = él)
 */
export async function listSwapsForEmployee(employeeId: string): Promise<ShiftSwapRequest[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('shift_swap_requests')
    .select('*')
    .or(`requester_id.eq.${employeeId},target_id.eq.${employeeId}`)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[shiftSwap] listSwapsForEmployee:', error)
    return []
  }
  return (data || []).map(r => rowToSwap(r as ShiftSwapRow))
}

/* =====================================================
   APLICAR EL CAMBIO AL SCHEDULE
   ===================================================== */

/**
 * Aplica el cambio al/los schedules afectados:
 * - Cesión / Petición directa: en el turno del solicitante, sustituye su id por el target.
 * - Intercambio: dos modificaciones, una en cada turno (cells).
 *
 * Las celdas tienen estructura:
 *   cells[templateId][dayKey] = string[]  (array de employeeIds)
 */
async function applySwapToSchedule(swap: ShiftSwapRequest): Promise<boolean> {
  if (!supabase) return false
  if (!swap.targetId) return false

  // 1) Aplicar al turno del requester (sustituir requester por target)
  const ok1 = await replaceEmployeeInCell(
    swap.requesterScheduleId,
    swap.requesterTemplateId,
    swap.requesterDayKey,
    swap.requesterId,
    swap.targetId
  )
  if (!ok1) return false

  // 2) Si es intercambio, aplicar también el inverso en el turno del target
  if (swap.swapType === 'intercambio' &&
      swap.targetScheduleId &&
      swap.targetTemplateId &&
      swap.targetDayKey) {
    const ok2 = await replaceEmployeeInCell(
      swap.targetScheduleId,
      swap.targetTemplateId,
      swap.targetDayKey,
      swap.targetId,
      swap.requesterId
    )
    if (!ok2) return false
  }
  return true
}

/**
 * En el schedule indicado, encuentra el array de empleados de
 * `cells[templateId][dayKey]`, sustituye `oldEmployeeId` por `newEmployeeId`
 * y guarda el schedule.
 */
async function replaceEmployeeInCell(
  scheduleId: string,
  templateId: string,
  dayKey: string,
  oldEmployeeId: string,
  newEmployeeId: string
): Promise<boolean> {
  if (!supabase) return false

  // Cargar schedule
  const { data: scheduleRow, error: getErr } = await supabase
    .from('schedules')
    .select('*')
    .eq('id', scheduleId)
    .maybeSingle()
  if (getErr || !scheduleRow) {
    console.error('[shiftSwap] replaceEmployeeInCell: schedule no encontrado', getErr)
    return false
  }
  const schedule = scheduleRow as Schedule
  const cells: ScheduleCells = (schedule.cells as ScheduleCells) || {}

  const tplCells = cells[templateId]
  if (!tplCells) {
    console.error('[shiftSwap] replaceEmployeeInCell: templateId no encontrado en cells')
    return false
  }
  const dayList = tplCells[dayKey]
  if (!Array.isArray(dayList)) {
    console.error('[shiftSwap] replaceEmployeeInCell: dayKey no encontrado')
    return false
  }
  const idx = dayList.indexOf(oldEmployeeId)
  if (idx === -1) {
    console.error('[shiftSwap] replaceEmployeeInCell: empleado no estaba en la celda')
    return false
  }

  // Reemplazar (manteniendo el resto del array)
  const newDayList = [...dayList]
  newDayList[idx] = newEmployeeId
  const newCells: ScheduleCells = {
    ...cells,
    [templateId]: {
      ...tplCells,
      [dayKey]: newDayList,
    },
  }

  // Guardar
  const { error: updErr } = await supabase
    .from('schedules')
    .update({ cells: newCells })
    .eq('id', scheduleId)
  if (updErr) {
    console.error('[shiftSwap] replaceEmployeeInCell: error al guardar', updErr)
    return false
  }
  return true
}

/* =====================================================
   NOTIFICACIONES
   ===================================================== */

/**
 * Notifica al target cuando le llega una propuesta nueva.
 */
async function notifyTarget(
  swap: ShiftSwapRequest,
  _kind: 'incoming_swap_request'
): Promise<void> {
  if (!swap.targetId) return
  try {
    const fechaLegible = new Date(swap.requesterDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
    const titulo = swap.swapType === 'intercambio'
      ? '🔄 Intercambio de turnos'
      : '🙏 Petición de cambio'
    const cuerpo = swap.swapType === 'intercambio'
      ? `Un compañero te propone intercambiar turnos. El suyo es el ${fechaLegible}.`
      : `Un compañero te pide que cojas su turno del ${fechaLegible}.`
    await createNotification(
      swap.targetId,
      'shift_swap_request',
      titulo,
      cuerpo,
      { swapId: swap.id, swapType: swap.swapType }
    )
  } catch (e) {
    console.warn('[shiftSwap] notifyTarget falló:', e)
  }
}

/**
 * Notifica a ambas partes cuando el gestor aprueba o rechaza.
 */
async function notifySwapResolved(
  swap: ShiftSwapRequest,
  resolution: 'aprobada' | 'rechazada'
): Promise<void> {
  const fechaLegible = new Date(swap.requesterDate + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  const titulo = resolution === 'aprobada'
    ? '✅ Cambio de turno aprobado'
    : '❌ Cambio de turno rechazado'
  const cuerpo = resolution === 'aprobada'
    ? `Tu cambio del turno del ${fechaLegible} ha sido aprobado por el gestor.`
    : `Tu cambio del turno del ${fechaLegible} ha sido rechazado por el gestor.`

  const notify = async (empId: string) => {
    try {
      await createNotification(
        empId,
        'shift_swap_request',
        titulo,
        cuerpo,
        { swapId: swap.id, resolution }
      )
    } catch (e) {
      console.warn('[shiftSwap] notify falló:', e)
    }
  }

  await notify(swap.requesterId)
  if (swap.targetId && swap.targetId !== swap.requesterId) {
    await notify(swap.targetId)
  }
}
