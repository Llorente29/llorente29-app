// src/modules/appcc/services/executionsService.ts
// Servicio de acceso a datos de ejecuciones APPCC:
// - Listar checklists pendientes/completados
// - Crear, iniciar, guardar respuestas y completar
//
// Las RLS de Supabase filtran por account_id automáticamente.

import { supabase } from '@/lib/supabase'
import type {
  AppccExecution,
  AppccExecutionResponse,
} from '@/modules/appcc/types'

// Valor que se puede pasar a saveResponse según el field_type del item.
// Solo uno de estos campos se rellenará por respuesta.
export interface SaveResponseInput {
  numeric_value?: number | null
  boolean_value?: boolean | null
  text_value?: string | null
  date_value?: string | null
  selected_option_id?: string | null
}

// Datos opcionales para firmar al completar la ejecución.
// Para MVP: firma electrónica simple (user logueado + timestamp + IP).
export interface CompleteExecutionInput {
  notes?: string | null
}

/**
 * Devuelve los checklists pendientes/en curso/vencidos de HOY en un local.
 * Es la base de la TodayPage ("Mis checklist de hoy").
 */
export async function listTodayExecutions(
  locationId: string
): Promise<AppccExecution[]> {
  if (!supabase) return []

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const { data, error } = await supabase
    .from('appcc_executions')
    .select('*')
    .eq('location_id', locationId)
    .eq('scheduled_date', today)
    .in('status', ['pending', 'in_progress', 'overdue'])
    .order('scheduled_time', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[appcc/executionsService] listTodayExecutions error', error)
    throw error
  }
  return (data ?? []) as AppccExecution[]
}

/**
 * Devuelve TODAS las ejecuciones de una fecha concreta en un local,
 * sin filtrar por estado. Útil para la lazy generation, que necesita saber
 * si ya existe alguna execution (en cualquier estado) para un schedule dado,
 * antes de crear una nueva.
 */
export async function listExecutionsForDate(
  locationId: string,
  isoDate: string  // YYYY-MM-DD
): Promise<AppccExecution[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_executions')
    .select('*')
    .eq('location_id', locationId)
    .eq('scheduled_date', isoDate)

  if (error) {
    console.error('[appcc/executionsService] listExecutionsForDate error', error)
    throw error
  }
  return (data ?? []) as AppccExecution[]
}

/**
 * Devuelve ejecuciones en un rango de fechas (para histórico/inspecciones).
 */
export async function listByDateRange(
  locationId: string,
  fromDate: string, // YYYY-MM-DD
  toDate: string    // YYYY-MM-DD
): Promise<AppccExecution[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_executions')
    .select('*')
    .eq('location_id', locationId)
    .gte('scheduled_date', fromDate)
    .lte('scheduled_date', toDate)
    .order('scheduled_date', { ascending: false })
    .order('scheduled_time', { ascending: false, nullsFirst: false })

  if (error) {
    console.error('[appcc/executionsService] listByDateRange error', error)
    throw error
  }
  return (data ?? []) as AppccExecution[]
}

/**
 * Devuelve una ejecución concreta con sus respuestas.
 */
export async function getExecution(
  executionId: string
): Promise<{ execution: AppccExecution; responses: AppccExecutionResponse[] } | null> {
  if (!supabase) return null

  const { data: execution, error: execErr } = await supabase
    .from('appcc_executions')
    .select('*')
    .eq('id', executionId)
    .single()

  if (execErr) {
    console.error('[appcc/executionsService] getExecution (exec) error', execErr)
    throw execErr
  }
  if (!execution) return null

  const { data: responses, error: respErr } = await supabase
    .from('appcc_execution_responses')
    .select('*')
    .eq('execution_id', executionId)

  if (respErr) {
    console.error('[appcc/executionsService] getExecution (resp) error', respErr)
    throw respErr
  }

  return {
    execution: execution as AppccExecution,
    responses: (responses ?? []) as AppccExecutionResponse[],
  }
}

/**
 * Opciones extra para crear una ejecución.
 * Se usan principalmente desde la lazy generation:
 *   - scheduleId   → enlaza esta execution con el schedule que la generó.
 *   - scheduledTime → hora del día prevista, en HH:MM o HH:MM:SS.
 */
export interface CreateExecutionOptions {
  scheduledDate?: string         // YYYY-MM-DD (default: hoy)
  scheduleId?: string | null
  scheduledTime?: string | null  // 'HH:MM' o 'HH:MM:SS'
}

/**
 * Crea una ejecución.
 *
 * Usos:
 *   - Manual ad-hoc (botón "+ Arrancar checklist"):
 *       createExecution(accountId, locationId, templateId)
 *   - Generada por un schedule (lazy generation en TodayPage):
 *       createExecution(accountId, locationId, templateId, {
 *         scheduleId: s.id,
 *         scheduledTime: s.scheduled_time,
 *       })
 *
 * El 4º parámetro acepta tanto un string (compatibilidad con la firma antigua,
 * donde era simplemente scheduledDate) como un objeto CreateExecutionOptions.
 */
export async function createExecution(
  accountId: string,
  locationId: string,
  templateId: string,
  optionsOrDate?: string | CreateExecutionOptions
): Promise<AppccExecution> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Normalizar el cuarto argumento: string (legacy) o objeto (nuevo)
  const opts: CreateExecutionOptions =
    typeof optionsOrDate === 'string'
      ? { scheduledDate: optionsOrDate }
      : (optionsOrDate ?? {})

  const date = opts.scheduledDate ?? new Date().toISOString().slice(0, 10)
  const time = normalizeTime(opts.scheduledTime ?? null)

  const { data, error } = await supabase
    .from('appcc_executions')
    .insert({
      account_id: accountId,
      location_id: locationId,
      template_id: templateId,
      schedule_id: opts.scheduleId ?? null,
      scheduled_date: date,
      scheduled_time: time,
      status: 'pending',
    })
    .select()
    .single()

  if (error) {
    console.error('[appcc/executionsService] createExecution error', error)
    throw error
  }
  return data as AppccExecution
}

/**
 * Marca una ejecución como iniciada (estado in_progress).
 * Llama esta función al abrir el checklist por primera vez.
 */
export async function startExecution(
  executionId: string,
  userId: string
): Promise<AppccExecution> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_executions')
    .update({
      status: 'in_progress',
      started_at: new Date().toISOString(),
      started_by: userId,
    })
    .eq('id', executionId)
    .select()
    .single()

  if (error) {
    console.error('[appcc/executionsService] startExecution error', error)
    throw error
  }
  return data as AppccExecution
}

/**
 * Guarda (o actualiza, si ya existía) la respuesta a un item.
 * El trigger de Supabase calcula `is_out_of_range` y crea incidencia automática si toca.
 * Auto-save: se puede llamar tras cada cambio en la UI.
 */
export async function saveResponse(
  executionId: string,
  itemId: string,
  value: SaveResponseInput,
  userId: string
): Promise<AppccExecutionResponse> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Upsert por (execution_id, item_id) — la UNIQUE constraint del SQL nos protege.
  const { data, error } = await supabase
    .from('appcc_execution_responses')
    .upsert(
      {
        execution_id: executionId,
        item_id: itemId,
        numeric_value: value.numeric_value ?? null,
        boolean_value: value.boolean_value ?? null,
        text_value: value.text_value ?? null,
        date_value: value.date_value ?? null,
        selected_option_id: value.selected_option_id ?? null,
        answered_by: userId,
        answered_at: new Date().toISOString(),
      },
      { onConflict: 'execution_id,item_id' }
    )
    .select()
    .single()

  if (error) {
    console.error('[appcc/executionsService] saveResponse error', error)
    throw error
  }
  return data as AppccExecutionResponse
}

/**
 * Marca una ejecución como completada y registra la firma electrónica simple.
 * NO valida que todos los items obligatorios estén respondidos; eso es responsabilidad
 * de la capa de UI antes de llamar a esta función.
 */
export async function completeExecution(
  executionId: string,
  userId: string,
  input: CompleteExecutionInput = {}
): Promise<AppccExecution> {
  if (!supabase) throw new Error('Supabase no disponible')

  const now = new Date().toISOString()

  // 1. Marcar la ejecución como completada
  const { data: execution, error: execErr } = await supabase
    .from('appcc_executions')
    .update({
      status: 'completed',
      completed_at: now,
      completed_by: userId,
      notes: input.notes ?? null,
    })
    .eq('id', executionId)
    .select()
    .single()

  if (execErr) {
    console.error('[appcc/executionsService] completeExecution (exec) error', execErr)
    throw execErr
  }

  // 2. Crear firma electrónica simple
  // Hash simple para detectar manipulación posterior (no es criptográfico fuerte,
  // es suficiente para firma simple según eIDAS).
  const payload = `${userId}|${executionId}|${now}`
  const signatureHash = await hashString(payload)

  const { error: sigErr } = await supabase
    .from('appcc_signatures')
    .insert({
      execution_id: executionId,
      user_id: userId,
      signed_at: now,
      signature_hash: signatureHash,
      // ip_address y user_agent se podrían rellenar desde un edge function;
      // de momento los dejamos null en frontend (Supabase no expone IP cliente).
    })

  if (sigErr) {
    console.error('[appcc/executionsService] completeExecution (signature) error', sigErr)
    throw sigErr
  }

  return execution as AppccExecution
}

/**
 * Helper: SHA-256 del string usando Web Crypto API.
 */
async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const buffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Normaliza un valor de hora al formato 'HH:MM:SS' que espera Postgres.
 * Acepta 'HH:MM' o 'HH:MM:SS', null lo deja pasar.
 */
function normalizeTime(value: string | null): string | null {
  if (value === null || value === undefined || value === '') return null
  if (/^\d{2}:\d{2}$/.test(value)) return value + ':00'
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value
  return value
}