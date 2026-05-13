// src/modules/appcc/services/incidentsService.ts
// Servicio de gestión de incidencias APPCC:
// - Listar abiertas/en curso para alertas
// - Ver detalle con acciones correctivas
// - Cambiar estado, resolver, añadir acciones
// - Crear incidencia manual (sin venir de una ejecución APPCC)
//
// Las RLS de Supabase filtran por account_id automáticamente.

import { supabase } from '@/lib/supabase'
import type {
  AppccIncident,
  AppccSeverity,
} from '@/modules/appcc/types'

// Una acción correctiva/preventiva registrada en una incidencia
export interface AppccIncidentAction {
  id: string
  incident_id: string
  description: string
  action_type: 'corrective' | 'preventive' | 'observation' | 'escalation' | null
  taken_at: string
  taken_by: string | null
  created_at: string
}

export interface CreateManualIncidentInput {
  accountId: string
  locationId: string
  title: string
  description?: string
  severity: AppccSeverity
  assignedTo?: string | null
  createdBy: string
}

/**
 * Lista incidencias abiertas o en curso de un local.
 * Es lo que alimenta el badge "X incidencias abiertas" del dashboard.
 */
export async function listOpenIncidents(
  locationId: string
): Promise<AppccIncident[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_incidents')
    .select('*')
    .eq('location_id', locationId)
    .in('status', ['open', 'in_progress'])
    .order('severity', { ascending: false }) // critical primero (orden alfabético inverso ≠ severidad, ver nota)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[appcc/incidentsService] listOpenIncidents error', error)
    throw error
  }
  return (data ?? []) as AppccIncident[]
}

/**
 * Lista incidencias en un rango de fechas (para histórico).
 */
export async function listIncidentsByDateRange(
  locationId: string,
  fromDate: string, // ISO date YYYY-MM-DD
  toDate: string
): Promise<AppccIncident[]> {
  if (!supabase) return []

  // Filtramos por created_at convertido a fecha. PostgREST acepta range con timestamps,
  // así que pasamos los límites del día como ISO completo.
  const fromTs = `${fromDate}T00:00:00Z`
  const toTs = `${toDate}T23:59:59Z`

  const { data, error } = await supabase
    .from('appcc_incidents')
    .select('*')
    .eq('location_id', locationId)
    .gte('created_at', fromTs)
    .lte('created_at', toTs)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[appcc/incidentsService] listIncidentsByDateRange error', error)
    throw error
  }
  return (data ?? []) as AppccIncident[]
}

/**
 * Devuelve una incidencia con sus acciones correctivas.
 */
export async function getIncidentWithActions(
  incidentId: string
): Promise<{ incident: AppccIncident; actions: AppccIncidentAction[] } | null> {
  if (!supabase) return null

  const { data: incident, error: incErr } = await supabase
    .from('appcc_incidents')
    .select('*')
    .eq('id', incidentId)
    .single()

  if (incErr) {
    console.error('[appcc/incidentsService] getIncidentWithActions (inc) error', incErr)
    throw incErr
  }
  if (!incident) return null

  const { data: actions, error: actErr } = await supabase
    .from('appcc_incident_actions')
    .select('*')
    .eq('incident_id', incidentId)
    .order('taken_at', { ascending: true })

  if (actErr) {
    console.error('[appcc/incidentsService] getIncidentWithActions (actions) error', actErr)
    throw actErr
  }

  return {
    incident: incident as AppccIncident,
    actions: (actions ?? []) as AppccIncidentAction[],
  }
}

/**
 * Marca una incidencia como "en curso" y asigna responsable.
 */
export async function markInProgress(
  incidentId: string,
  userId: string
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      status: 'in_progress',
      assigned_to: userId,
    })
    .eq('id', incidentId)
    .select()
    .single()

  if (error) {
    console.error('[appcc/incidentsService] markInProgress error', error)
    throw error
  }
  return data as AppccIncident
}

/**
 * Añade una acción correctiva/preventiva sin cerrar la incidencia.
 */
export async function addAction(
  incidentId: string,
  description: string,
  actionType: AppccIncidentAction['action_type'],
  userId: string
): Promise<AppccIncidentAction> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_incident_actions')
    .insert({
      incident_id: incidentId,
      description,
      action_type: actionType,
      taken_by: userId,
    })
    .select()
    .single()

  if (error) {
    console.error('[appcc/incidentsService] addAction error', error)
    throw error
  }
  return data as AppccIncidentAction
}

/**
 * Resuelve una incidencia: añade una acción correctiva final y cierra.
 * Operación atómica desde la perspectiva del usuario.
 */
export async function resolveIncident(
  incidentId: string,
  userId: string,
  resolutionNote: string
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const now = new Date().toISOString()

  // 1. Registrar la acción correctiva final
  const { error: actErr } = await supabase
    .from('appcc_incident_actions')
    .insert({
      incident_id: incidentId,
      description: resolutionNote,
      action_type: 'corrective',
      taken_by: userId,
      taken_at: now,
    })

  if (actErr) {
    console.error('[appcc/incidentsService] resolveIncident (action) error', actErr)
    throw actErr
  }

  // 2. Marcar incidencia como resuelta
  const { data: incident, error: incErr } = await supabase
    .from('appcc_incidents')
    .update({
      status: 'resolved',
      resolved_at: now,
      resolved_by: userId,
    })
    .eq('id', incidentId)
    .select()
    .single()

  if (incErr) {
    console.error('[appcc/incidentsService] resolveIncident (update) error', incErr)
    throw incErr
  }
  return incident as AppccIncident
}

/**
 * Crea una incidencia manual (no procedente de una ejecución APPCC).
 * Útil para que un encargado registre un problema detectado fuera del checklist.
 */
export async function createManualIncident(
  input: CreateManualIncidentInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  // SLA por severidad (mismas horas que el trigger automático)
  const slaHours: Record<AppccSeverity, number> = {
    critical: 2,
    high: 8,
    medium: 24,
    low: 72,
  }
  const slaDueAt = new Date(Date.now() + slaHours[input.severity] * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('appcc_incidents')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity,
      status: 'open',
      source: 'manual',
      assigned_to: input.assignedTo ?? null,
      sla_due_at: slaDueAt,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) {
    console.error('[appcc/incidentsService] createManualIncident error', error)
    throw error
  }
  return data as AppccIncident
}