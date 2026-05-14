// src/modules/appcc/services/schedulesService.ts
// Servicio de gestión de schedules (programaciones) APPCC.
// Un schedule define: "en este local, cada X (frecuencia), se debe ejecutar
// esta plantilla, opcionalmente a esta hora". El sistema de lazy generation
// crea automáticamente las executions del día a partir de los schedules activos.

import { supabase } from '@/lib/supabase'
import type {
  AppccSchedule,
  AppccRecurrenceType,
  AppccEssentialPreset,
} from '@/modules/appcc/types'

// ============================================================
// PRESETS DE LAS 8 PLANTILLAS ESENCIALES
// Códigos exactos confirmados contra appcc_templates.code en Supabase.
// ============================================================

export const ESSENTIAL_TEMPLATE_PRESETS: AppccEssentialPreset[] = [
  // Apertura
  { templateCode: 'hygiene_daily',         dayPeriod: 'opening', timeOffsetMinutes: 0 },
  { templateCode: 'temp_cameras_am',       dayPeriod: 'opening', timeOffsetMinutes: 30 },

  // Durante el servicio (sin hora sugerida)
  { templateCode: 'oil_check_daily',       dayPeriod: 'anytime', timeOffsetMinutes: null },
  { templateCode: 'expiry_cameras_daily',  dayPeriod: 'anytime', timeOffsetMinutes: null },

  // Cierre
  { templateCode: 'temp_cameras_pm',       dayPeriod: 'closing', timeOffsetMinutes: -60 },
  { templateCode: 'clean_kitchen_daily',   dayPeriod: 'closing', timeOffsetMinutes: 0 },
  { templateCode: 'clean_diningroom_daily',dayPeriod: 'closing', timeOffsetMinutes: 0 },
  { templateCode: 'clean_toilets_daily',   dayPeriod: 'closing', timeOffsetMinutes: 0 },
]

// ============================================================
// LECTURA
// ============================================================

/**
 * Lista los schedules activos de un local (sin filtrar por fecha).
 * Útil para la pantalla admin y para detectar si un local está configurado.
 */
export async function listActiveSchedules(locationId: string): Promise<AppccSchedule[]> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_schedules')
    .select('*')
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('scheduled_time', { ascending: true, nullsFirst: false })

  if (error) throw error
  return (data ?? []) as AppccSchedule[]
}

/**
 * Cuenta schedules activos en un local.
 * Devuelve 0 si el local no está configurado todavía.
 * Usado por TodayPage para decidir si mostrar el botón "Configurar APPCC".
 */
export async function countActiveSchedules(locationId: string): Promise<number> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { count, error } = await supabase
    .from('appcc_schedules')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .eq('is_active', true)

  if (error) throw error
  return count ?? 0
}

/**
 * Devuelve los schedules que aplican en una fecha concreta para un local.
 * Aplica la lógica de recurrencia:
 *   - daily: aplica siempre
 *   - weekly: aplica si recurrence_config.weekdays incluye el día (0=domingo, 1=lunes, ...)
 *   - monthly: aplica si recurrence_config.day_of_month == día del mes
 *   - quarterly/yearly/on_event/manual: no se generan automáticamente por lazy
 *
 * Respeta valid_from / valid_until.
 */
export async function getSchedulesForDate(
  locationId: string,
  isoDate: string,
): Promise<AppccSchedule[]> {
  const all = await listActiveSchedules(locationId)
  const date = new Date(isoDate + 'T00:00:00')
  const weekday = date.getDay()      // 0=domingo, 1=lunes, ..., 6=sábado
  const dayOfMonth = date.getDate()  // 1..31

  return all.filter(s => {
    // Respetar ventana de validez
    if (s.valid_from && isoDate < s.valid_from) return false
    if (s.valid_until && isoDate > s.valid_until) return false

    switch (s.recurrence_type) {
      case 'daily':
        return true
      case 'weekly': {
        const days = (s.recurrence_config?.weekdays as number[] | undefined) ?? []
        return days.includes(weekday)
      }
      case 'monthly': {
        const dom = s.recurrence_config?.day_of_month as number | undefined
        return dom === dayOfMonth
      }
      case 'quarterly':
      case 'yearly':
      case 'on_event':
      case 'manual':
        // No se generan por lazy; el admin las crea manualmente
        return false
      default:
        return false
    }
  })
}

// ============================================================
// ESCRITURA
// ============================================================

export interface CreateScheduleInput {
  accountId: string
  locationId: string
  templateId: string
  recurrenceType: AppccRecurrenceType
  recurrenceConfig?: Record<string, unknown>
  scheduledTime?: string | null      // 'HH:MM' o 'HH:MM:SS'
  validFrom?: string                 // 'YYYY-MM-DD' (default: hoy)
  validUntil?: string | null
  createdBy?: string | null
}

/**
 * Crea un schedule. Devuelve la fila insertada.
 */
export async function createSchedule(input: CreateScheduleInput): Promise<AppccSchedule> {
  if (!supabase) throw new Error('Supabase no disponible')

  const row = {
    account_id: input.accountId,
    location_id: input.locationId,
    template_id: input.templateId,
    recurrence_type: input.recurrenceType,
    recurrence_config: input.recurrenceConfig ?? {},
    scheduled_time: normalizeTime(input.scheduledTime ?? null),
    valid_from: input.validFrom ?? new Date().toISOString().slice(0, 10),
    valid_until: input.validUntil ?? null,
    is_active: true,
    created_by: input.createdBy ?? null,
  }

  const { data, error } = await supabase
    .from('appcc_schedules')
    .insert(row)
    .select('*')
    .single()

  if (error) throw error
  return data as AppccSchedule
}

/**
 * Crea varios schedules de golpe (lo que usa el wizard de onboarding).
 */
export async function bulkCreateSchedules(items: CreateScheduleInput[]): Promise<AppccSchedule[]> {
  if (!supabase) throw new Error('Supabase no disponible')
  if (items.length === 0) return []

  const rows = items.map(input => ({
    account_id: input.accountId,
    location_id: input.locationId,
    template_id: input.templateId,
    recurrence_type: input.recurrenceType,
    recurrence_config: input.recurrenceConfig ?? {},
    scheduled_time: normalizeTime(input.scheduledTime ?? null),
    valid_from: input.validFrom ?? new Date().toISOString().slice(0, 10),
    valid_until: input.validUntil ?? null,
    is_active: true,
    created_by: input.createdBy ?? null,
  }))

  const { data, error } = await supabase
    .from('appcc_schedules')
    .insert(rows)
    .select('*')

  if (error) throw error
  return (data ?? []) as AppccSchedule[]
}

export interface UpdateScheduleInput {
  recurrenceType?: AppccRecurrenceType
  recurrenceConfig?: Record<string, unknown>
  scheduledTime?: string | null
  validFrom?: string
  validUntil?: string | null
  isActive?: boolean
}

/**
 * Edita un schedule existente. Solo actualiza los campos provistos.
 */
export async function updateSchedule(
  scheduleId: string,
  patch: UpdateScheduleInput,
): Promise<AppccSchedule> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Construir el objeto de actualización solo con los campos definidos
  const update: Record<string, unknown> = {}
  if (patch.recurrenceType !== undefined) update.recurrence_type = patch.recurrenceType
  if (patch.recurrenceConfig !== undefined) update.recurrence_config = patch.recurrenceConfig
  if (patch.scheduledTime !== undefined) update.scheduled_time = normalizeTime(patch.scheduledTime)
  if (patch.validFrom !== undefined) update.valid_from = patch.validFrom
  if (patch.validUntil !== undefined) update.valid_until = patch.validUntil
  if (patch.isActive !== undefined) update.is_active = patch.isActive

  const { data, error } = await supabase
    .from('appcc_schedules')
    .update(update)
    .eq('id', scheduleId)
    .select('*')
    .single()

  if (error) throw error
  return data as AppccSchedule
}

/**
 * Desactiva un schedule (soft delete). Las executions futuras dejan de generarse,
 * pero las ya creadas no se tocan.
 */
export async function deactivateSchedule(scheduleId: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { error } = await supabase
    .from('appcc_schedules')
    .update({ is_active: false })
    .eq('id', scheduleId)

  if (error) throw error
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Normaliza un valor de hora al formato 'HH:MM:SS' que espera Postgres.
 * Acepta 'HH:MM' o 'HH:MM:SS', null lo deja pasar.
 */
function normalizeTime(value: string | null): string | null {
  if (value === null || value === undefined || value === '') return null
  if (/^\d{2}:\d{2}$/.test(value)) return value + ':00'
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value
  // Si llega algo raro, lo devolvemos tal cual y dejamos que Postgres se queje
  return value
}

/**
 * Calcula la hora sugerida para un preset, dadas las horas de apertura/cierre del local.
 * Devuelve 'HH:MM' o null si el preset no tiene hora (anytime o offset null).
 *
 * @param preset      Preset de plantilla esencial
 * @param openingTime 'HH:MM' apertura del local
 * @param closingTime 'HH:MM' cierre del local
 */
export function computeSuggestedTime(
  preset: AppccEssentialPreset,
  openingTime: string,
  closingTime: string,
): string | null {
  if (preset.dayPeriod === 'anytime' || preset.timeOffsetMinutes === null) {
    return null
  }

  const base = preset.dayPeriod === 'opening' ? openingTime : closingTime
  return addMinutesToHHMM(base, preset.timeOffsetMinutes)
}

/**
 * Suma minutos a una hora 'HH:MM' y devuelve 'HH:MM'.
 * Si el resultado se va del rango 0-23h, hace wrap-around (módulo 24h).
 */
function addMinutesToHHMM(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return hhmm

  let total = h * 60 + m + minutes
  // Wrap-around dentro de un día (0..1439 minutos)
  total = ((total % 1440) + 1440) % 1440
  const hh = Math.floor(total / 60).toString().padStart(2, '0')
  const mm = (total % 60).toString().padStart(2, '0')
  return `${hh}:${mm}`
}