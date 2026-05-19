// src/modules/appcc/services/incidentsService.ts
// Servicio completo de gestión de incidencias APPCC con workflow CAPA.
// Implementa el flujo SafetyCulture/Intelex:
//   detectar → asignar → investigar → corregir → verificar → cerrar
//
// Cada transición:
//   1. Actualiza la incidencia
//   2. Registra un evento en appcc_incident_events (timeline)
//   3. Dispara notificación al responsable cuando aplica
//
// Las RLS de Supabase filtran por account_id automáticamente.

import { supabase } from '@/lib/supabase'
import * as notificationsService from '@/services/notificationsService'
import type { Database } from '@/types/database'
import type {
  AppccIncident,
  AppccIncidentEvent,
  AppccIncidentEventType,
  AppccIncidentPhoto,
  AppccIncidentStatus,
  AppccRootCauseMethod,
  AppccSeverity,
} from '@/modules/appcc/types'
import { SLA_HOURS_BY_SEVERITY, OPEN_STATUSES } from '@/modules/appcc/types'

// Tipos helper para inserts/updates tipados
type IncidentPhotoInsert = Database['public']['Tables']['appcc_incident_photos']['Insert']
type IncidentEventInsert = Database['public']['Tables']['appcc_incident_events']['Insert']
type IncidentUpdate = Database['public']['Tables']['appcc_incidents']['Update']
type Json = Database['public']['Tables']['appcc_incidents']['Row']['root_cause_data']

// ============================================================
// Acciones legacy (se mantiene para compatibilidad con código viejo)
// ============================================================

export interface AppccIncidentAction {
  id: string
  incident_id: string
  description: string
  action_type: 'corrective' | 'preventive' | 'observation' | 'escalation' | null
  taken_at: string
  taken_by: string | null
  created_at: string
}

// ============================================================
// INPUTS
// ============================================================

export interface CreateManualIncidentInput {
  accountId: string
  locationId: string
  title: string
  description?: string
  severity: AppccSeverity
  category?: string | null
  assignedTo?: string | null
  createdBy: string | null
}

export interface AssignIncidentInput {
  incidentId: string
  userId: string          // a quién se le asigna
  byUserId: string | null   // quién asigna (null si admin sin employee)
  byUserName?: string
  slaHours?: number       // override del SLA por defecto
}

export interface SetRootCauseInput {
  incidentId: string
  rootCause: string
  method: AppccRootCauseMethod
  data?: Record<string, unknown> | null  // p.ej. {whys: ['why1','why2',...]}
  byUserId: string | null
  byUserName?: string
}

export interface ApplyCorrectiveInput {
  incidentId: string
  correctiveAction: string
  byUserId: string | null
  byUserName?: string
}

export interface ApplyPreventiveInput {
  incidentId: string
  preventiveAction: string
  byUserId: string | null
  byUserName?: string
}

export interface VerifyIncidentInput {
  incidentId: string
  effective: boolean
  notes?: string
  byUserId: string | null
  byUserName?: string
}

export interface CloseIncidentInput {
  incidentId: string
  signature: string       // hash SHA-256
  byUserId: string | null
  byUserName?: string
}

export interface RejectIncidentInput {
  incidentId: string
  reason: string
  byUserId: string | null
  byUserName?: string
}

// ============================================================
// HELPER: registrar evento + opcionalmente notificar
// ============================================================

async function logEvent(
  incidentId: string,
  eventType: AppccIncidentEventType,
  description: string,
  actorId?: string | null,
  actorName?: string | null,
  data?: Record<string, unknown> | null,
): Promise<void> {
  if (!supabase) return
  // FIX: tipado fuerte del insert con cast de event_data a Json
  const insertRow: IncidentEventInsert = {
    incident_id: incidentId,
    event_type: eventType,
    description,
    actor_id: actorId ?? null,
    actor_name: actorName ?? null,
    event_data: (data ?? null) as Json,
  }
  const { error } = await supabase.from('appcc_incident_events').insert(insertRow)
  if (error) {
    console.error('[incidentsService] logEvent error', error)
  }
}

// ============================================================
// LISTADO
// ============================================================

/**
 * Lista incidencias abiertas (open, assigned, investigating, corrected)
 * de un local. Ordenadas por severidad crítica primero y luego created_at desc.
 */
export async function listOpenIncidents(
  locationId: string
): Promise<AppccIncident[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_incidents')
    .select('*')
    .eq('location_id', locationId)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[incidentsService] listOpenIncidents error', error)
    throw error
  }

  // Orden por severidad en cliente (orden alfabético no sirve)
  const sevOrder: Record<AppccSeverity, number> = {
    critical: 0, high: 1, medium: 2, low: 3,
  }
  return (data ?? [])
    .map(d => d as unknown as AppccIncident)
    .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity])
}

/**
 * Lista incidencias por rango de fechas (histórico).
 */
export async function listIncidentsByDateRange(
  locationId: string,
  fromDate: string,
  toDate: string,
): Promise<AppccIncident[]> {
  if (!supabase) return []

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
    console.error('[incidentsService] listIncidentsByDateRange error', error)
    throw error
  }
  return (data ?? []) as unknown as AppccIncident[]
}

/**
 * Lista incidencias escaladas (vencidas) de un local — para alertas dashboard.
 */
export async function listEscalatedIncidents(
  locationId: string
): Promise<AppccIncident[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('appcc_incidents')
    .select('*')
    .eq('location_id', locationId)
    .eq('escalated', true)
    .in('status', OPEN_STATUSES)
    .order('escalated_at', { ascending: false })

  if (error) {
    console.error('[incidentsService] listEscalatedIncidents error', error)
    throw error
  }
  return (data ?? []) as unknown as AppccIncident[]
}

// ============================================================
// DETALLE COMPLETO (incidencia + acciones legacy + eventos + fotos)
// ============================================================

export interface IncidentDetail {
  incident: AppccIncident
  actions: AppccIncidentAction[]   // legacy
  events: AppccIncidentEvent[]
  photos: AppccIncidentPhoto[]
}

export async function getIncidentDetail(
  incidentId: string
): Promise<IncidentDetail | null> {
  if (!supabase) return null

  const [incRes, actRes, evtRes, phRes] = await Promise.all([
    supabase.from('appcc_incidents').select('*').eq('id', incidentId).single(),
    supabase
      .from('appcc_incident_actions')
      .select('*')
      .eq('incident_id', incidentId)
      .order('taken_at', { ascending: true }),  // acciones SÍ tienen taken_at
    supabase
      .from('appcc_incident_events')
      .select('*')
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: true }),
    supabase
      .from('appcc_incident_photos')
      .select('*')
      .eq('incident_id', incidentId)
      .order('uploaded_at', { ascending: true }),  // FIX: era taken_at, ahora uploaded_at
  ])

  if (incRes.error) {
    console.error('[incidentsService] getIncidentDetail (inc) error', incRes.error)
    throw incRes.error
  }
  if (!incRes.data) return null

  return {
    incident: incRes.data as unknown as AppccIncident,
    actions: (actRes.data ?? []) as unknown as AppccIncidentAction[],
    events: (evtRes.data ?? []) as unknown as AppccIncidentEvent[],
    photos: (phRes.data ?? []) as AppccIncidentPhoto[],
  }
}

// Alias para compatibilidad con código que usa getIncidentWithActions
export async function getIncidentWithActions(
  incidentId: string
): Promise<{ incident: AppccIncident; actions: AppccIncidentAction[] } | null> {
  const detail = await getIncidentDetail(incidentId)
  if (!detail) return null
  return { incident: detail.incident, actions: detail.actions }
}

// ============================================================
// CREAR INCIDENCIA MANUAL
// ============================================================

export async function createManualIncident(
  input: CreateManualIncidentInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const slaHours = SLA_HOURS_BY_SEVERITY[input.severity]
  const dueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()

  const status: AppccIncidentStatus = input.assignedTo ? 'assigned' : 'open'

  const { data, error } = await supabase
    .from('appcc_incidents')
    .insert({
      account_id: input.accountId,
      location_id: input.locationId,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity,
      category: input.category ?? null,
      status,
      source: 'manual',
      assigned_to: input.assignedTo ?? null,
      assigned_at: input.assignedTo ? now : null,
      due_at: dueAt,
      sla_due_at: dueAt, // legacy
      sla_hours: slaHours,
      created_by: input.createdBy,
    })
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] createManualIncident error', error)
    throw error
  }

  const incident = data as unknown as AppccIncident

  await logEvent(
    incident.id,
    'created',
    `Incidencia creada manualmente (severidad ${input.severity})`,
    input.createdBy,
  )

  if (input.assignedTo) {
    await logEvent(
      incident.id,
      'assigned',
      'Asignada al crear',
      input.createdBy,
    )
    await notifyAssignment(incident, input.assignedTo)
  }

  return incident
}

// ============================================================
// WORKFLOW CAPA
// ============================================================

/**
 * Asignar (o reasignar) la incidencia a un responsable.
 * Calcula due_at en base a slaHours o severidad por defecto.
 */
export async function assignIncident(
  input: AssignIncidentInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  // Leer severidad actual para calcular SLA si no se especifica
  const { data: current } = await supabase
    .from('appcc_incidents')
    .select('severity, status')
    .eq('id', input.incidentId)
    .single()

  const sev = (current?.severity as AppccSeverity) ?? 'medium'
  const slaHours = input.slaHours ?? SLA_HOURS_BY_SEVERITY[sev]
  const now = new Date()
  const dueAt = new Date(now.getTime() + slaHours * 60 * 60 * 1000).toISOString()

  // Si está en 'open', pasa a 'assigned'; si ya estaba más avanzada, mantén status
  const currentStatus = (current?.status as AppccIncidentStatus) ?? 'open'
  const newStatus: AppccIncidentStatus =
    currentStatus === 'open' ? 'assigned' : currentStatus

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      assigned_to: input.userId,
      assigned_at: now.toISOString(),
      due_at: dueAt,
      sla_due_at: dueAt, // legacy
      sla_hours: slaHours,
      status: newStatus,
      // Resetear escalado si se reasigna
      escalated: false,
      escalated_at: null,
      escalated_to: null,
    })
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] assignIncident error', error)
    throw error
  }
  const incident = data as unknown as AppccIncident

  await logEvent(
    incident.id,
    'assigned',
    `Asignada (SLA ${slaHours}h)`,
    input.byUserId,
    input.byUserName,
    { assignee_id: input.userId, sla_hours: slaHours, due_at: dueAt },
  )

  await notifyAssignment(incident, input.userId)

  return incident
}

/**
 * Marcar como "investigando" (cuando se empieza a trabajar).
 */
export async function startInvestigation(
  incidentId: string,
  byUserId: string | null,
  byUserName?: string,
): Promise<AppccIncident> {
  return updateStatus(incidentId, 'investigating', 'Investigación iniciada', byUserId, byUserName)
}

/**
 * Registrar root cause (análisis de causa raíz).
 */
export async function setRootCause(input: SetRootCauseInput): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  // FIX: tipado fuerte del update con cast de root_cause_data a Json
  const update: IncidentUpdate = {
    root_cause: input.rootCause,
    root_cause_method: input.method,
    root_cause_data: (input.data ?? null) as Json,
    status: 'investigating', // fuerza a investigando
  }

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update(update)
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] setRootCause error', error)
    throw error
  }

  await logEvent(
    input.incidentId,
    'root_cause_set',
    `Causa raíz registrada (${input.method})`,
    input.byUserId,
    input.byUserName,
    { method: input.method, root_cause: input.rootCause },
  )

  return data as unknown as AppccIncident
}

/**
 * Aplicar acción correctiva → status 'corrected'.
 */
export async function applyCorrective(
  input: ApplyCorrectiveInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      corrective_action: input.correctiveAction,
      corrective_action_at: now,
      corrective_action_by: input.byUserId,
      status: 'corrected',
      // Legacy
      resolved_at: now,
      resolved_by: input.byUserId,
    })
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] applyCorrective error', error)
    throw error
  }

  await logEvent(
    input.incidentId,
    'corrective_applied',
    'Acción correctiva aplicada',
    input.byUserId,
    input.byUserName,
    { action: input.correctiveAction },
  )

  // Notificar a admins del local para que verifiquen
  const incident = data as unknown as AppccIncident
  await notifyVerificationPending(incident)

  return incident
}

/**
 * Aplicar acción preventiva (opcional, no cambia status).
 */
export async function applyPreventive(
  input: ApplyPreventiveInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      preventive_action: input.preventiveAction,
      preventive_action_at: now,
      preventive_action_by: input.byUserId,
    })
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] applyPreventive error', error)
    throw error
  }

  await logEvent(
    input.incidentId,
    'preventive_applied',
    'Acción preventiva añadida',
    input.byUserId,
    input.byUserName,
    { action: input.preventiveAction },
  )

  return data as unknown as AppccIncident
}

/**
 * Verificar la efectividad de la acción correctiva → status 'verified' o 'investigating'.
 * Si la acción NO fue efectiva, se devuelve a investigating.
 */
export async function verifyIncident(
  input: VerifyIncidentInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const now = new Date().toISOString()
  const newStatus: AppccIncidentStatus = input.effective ? 'verified' : 'investigating'

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      verified_at: now,
      verified_by: input.byUserId,
      verification_notes: input.notes ?? null,
      verification_effective: input.effective,
      status: newStatus,
      // Si no fue efectiva, resetear corrective
      ...(input.effective ? {} : {
        corrective_action_at: null,
      }),
    })
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] verifyIncident error', error)
    throw error
  }

  await logEvent(
    input.incidentId,
    'verified',
    input.effective
      ? 'Verificación: acción efectiva ✓'
      : 'Verificación: acción NO efectiva, vuelta a investigación',
    input.byUserId,
    input.byUserName,
    { effective: input.effective, notes: input.notes },
  )

  return data as unknown as AppccIncident
}

/**
 * Cerrar formalmente la incidencia con firma. Status → 'closed'.
 */
export async function closeIncident(
  input: CloseIncidentInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      closed_at: now,
      closed_by: input.byUserId,
      closure_signature: input.signature,
      status: 'closed',
    })
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] closeIncident error', error)
    throw error
  }

  await logEvent(
    input.incidentId,
    'closed',
    'Incidencia cerrada formalmente con firma',
    input.byUserId,
    input.byUserName,
    { signature_prefix: input.signature.slice(0, 16) + '...' },
  )

  return data as unknown as AppccIncident
}

/**
 * Descartar la incidencia (no aplica / duplicada / falso positivo).
 */
export async function rejectIncident(
  input: RejectIncidentInput
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      status: 'rejected',
      closed_at: new Date().toISOString(),
      closed_by: input.byUserId,
      verification_notes: input.reason,
    })
    .eq('id', input.incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] rejectIncident error', error)
    throw error
  }

  await logEvent(
    input.incidentId,
    'rejected',
    `Descartada: ${input.reason}`,
    input.byUserId,
    input.byUserName,
  )

  return data as unknown as AppccIncident
}

/**
 * Reabrir una incidencia cerrada/verificada/rechazada.
 */
export async function reopenIncident(
  incidentId: string,
  reason: string,
  byUserId: string | null,
  byUserName?: string,
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({
      status: 'investigating',
      closed_at: null,
      closed_by: null,
      closure_signature: null,
      verified_at: null,
      verified_by: null,
      verification_effective: null,
    })
    .eq('id', incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] reopenIncident error', error)
    throw error
  }

  await logEvent(
    incidentId,
    'reopened',
    `Reabierta: ${reason}`,
    byUserId,
    byUserName,
  )

  return data as unknown as AppccIncident
}

// ============================================================
// MARCAR EN CURSO / RESOLVER (LEGACY — wrappers de compatibilidad)
// ============================================================

export async function markInProgress(
  incidentId: string,
  userId: string,
): Promise<AppccIncident> {
  return startInvestigation(incidentId, userId)
}

export async function resolveIncident(
  incidentId: string,
  userId: string,
  resolutionNote: string,
): Promise<AppccIncident> {
  // Legacy: aplica directamente correctiva
  return applyCorrective({
    incidentId,
    correctiveAction: resolutionNote,
    byUserId: userId,
  })
}

// Wrapper genérico para cambiar status sin tocar otros campos
async function updateStatus(
  incidentId: string,
  newStatus: AppccIncidentStatus,
  description: string,
  byUserId: string | null,
  byUserName?: string,
): Promise<AppccIncident> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_incidents')
    .update({ status: newStatus })
    .eq('id', incidentId)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] updateStatus error', error)
    throw error
  }

  await logEvent(incidentId, 'status_changed', description, byUserId, byUserName, {
    new_status: newStatus,
  })

  return data as unknown as AppccIncident
}

// ============================================================
// ACCIONES LEGACY (mantener por compatibilidad con código antiguo)
// ============================================================

export async function addAction(
  incidentId: string,
  description: string,
  actionType: AppccIncidentAction['action_type'],
  userId: string,
): Promise<AppccIncidentAction> {
  if (!supabase) throw new Error('Supabase no disponible')

  const { data, error } = await supabase
    .from('appcc_incident_actions')
    .insert({
      incident_id: incidentId,
      description,
      action_type: actionType,
      taken_by: userId,  // OK: esta columna SÍ existe en appcc_incident_actions
    })
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] addAction error', error)
    throw error
  }

  await logEvent(
    incidentId,
    'note_added',
    `${actionType ?? 'Nota'}: ${description.slice(0, 80)}`,
    userId,
    null,
    { action_type: actionType, full_text: description },
  )

  return data as AppccIncidentAction
}

// ============================================================
// FOTOS
// ============================================================

export async function listIncidentPhotos(
  incidentId: string
): Promise<AppccIncidentPhoto[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('appcc_incident_photos')
    .select('*')
    .eq('incident_id', incidentId)
    .order('uploaded_at', { ascending: true })  // FIX: era taken_at
  if (error) {
    console.error('[incidentsService] listIncidentPhotos error', error)
    throw error
  }
  return (data ?? []) as AppccIncidentPhoto[]
}

/**
 * Añadir una foto a una incidencia.
 *
 * ⚠️ Schema BBDD usa photo_kind/uploaded_by (alineado mayo 2026).
 */
export async function addIncidentPhoto(
  incidentId: string,
  storagePath: string,
  photoKind: 'problem' | 'corrective' | 'verification' | null,
  caption: string | null,
  userId: string | null,
): Promise<AppccIncidentPhoto> {
  if (!supabase) throw new Error('Supabase no disponible')

  // FIX: tipado fuerte del insert con nombres correctos de columnas
  const insertRow: IncidentPhotoInsert = {
    incident_id: incidentId,
    storage_path: storagePath,
    photo_kind: photoKind,     // FIX: era evidence_type
    caption,
    uploaded_by: userId,       // FIX: era taken_by
  }

  const { data, error } = await supabase
    .from('appcc_incident_photos')
    .insert(insertRow)
    .select()
    .single()

  if (error) {
    console.error('[incidentsService] addIncidentPhoto error', error)
    throw error
  }

  await logEvent(
    incidentId,
    'photo_added',
    `Foto añadida (${photoKind ?? 'evidencia'})`,
    userId,
    null,
    { storage_path: storagePath, photo_kind: photoKind },
  )

  return data as AppccIncidentPhoto
}

export async function deleteIncidentPhoto(photoId: string): Promise<void> {
  if (!supabase) return
  // Leer storage_path para borrar del bucket
  const { data: photo } = await supabase
    .from('appcc_incident_photos')
    .select('storage_path, incident_id')
    .eq('id', photoId)
    .single()

  const { error } = await supabase
    .from('appcc_incident_photos')
    .delete()
    .eq('id', photoId)

  if (error) {
    console.error('[incidentsService] deleteIncidentPhoto error', error)
    throw error
  }

  if (photo?.storage_path) {
    await supabase.storage.from('appcc-photos').remove([photo.storage_path])
  }
}

// ============================================================
// NOTIFICACIONES INTERNAS
// ------------------------------------------------------------
// Reutilizan el notificationsService existente (tabla
// `employee_notifications`, firma posicional). Tipo 'generic'
// porque APPCC aún no tiene tipo propio en NotificationType.
// El metadata va en `data` para que la UI pueda enlazar a la
// incidencia con incident_id/severity.
// ============================================================

async function notifyAssignment(incident: AppccIncident, employeeId: string) {
  await notificationsService.createNotification(
    employeeId,
    'generic',
    `Nueva incidencia: ${incident.title}`,
    `Severidad ${incident.severity}. Plazo: ${formatDueDate(incident.due_at)}.`,
    {
      kind: 'appcc_incident_assigned',
      incident_id: incident.id,
      severity: incident.severity,
      due_at: incident.due_at,
    },
  )
}

async function notifyVerificationPending(incident: AppccIncident) {
  // TODO(Bloque C+): notificar a admins/managers cuando se aplica una correctiva.
  // No se hace aquí porque el esquema de roles en `employees` no es accesible
  // desde el servicio. Soluciones futuras:
  //   1. Pasar la lista de managerIds desde el componente (que tiene useApp().staff)
  //   2. Crear un trigger SQL que inserte la notificación directamente
  //   3. Edge function que reciba el id y resuelva los managers
  console.info(
    '[incidentsService] notifyVerificationPending pendiente — incident:',
    incident.id
  )
}

function formatDueDate(iso: string | null): string {
  if (!iso) return 'sin plazo'
  const d = new Date(iso)
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
