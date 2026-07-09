// src/services/clockEditService.ts
// Edición y corrección de fichajes con rastro legal (RD registro horario 2026).
// Todas las mutaciones pasan por RPC SECURITY DEFINER (guardia de admin + motivo
// obligatorio); el trigger de BD sella la auditoría inmutable. El refresco de la
// lista de fichajes lo da el realtime de clock_entries ya existente (supabaseSync).
//
// DEUDA DECLARADA (disparador: regenerar database.ts cuando el CLI de Supabase
// esté sano): las tablas `clock_entry_audit`/`clock_correction_request` y las
// RPC nuevas no están en los tipos generados todavía, así que usamos un cliente
// laxo LOCAL (`db()`). Al regenerar database.ts, quitar `db()` y tipar normal.

import { supabase } from '../lib/supabase'

export type ClockType = 'entrada' | 'salida'
export type CorrectionKind = 'add' | 'edit' | 'void'
export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface ClockCorrectionRequest {
  id: string
  accountId: string
  employeeId: string
  requestedByEmployeeId: string
  clockEntryId?: string
  kind: CorrectionKind
  proposedType?: ClockType
  proposedDatetime?: string
  reason: string
  status: CorrectionStatus
  resolvedByUserId?: string
  resolvedAt?: string
  resolutionNote?: string
  createdAt: string
}

export interface ClockEntryAudit {
  id: string
  clockEntryId?: string
  employeeId?: string
  accountId?: string
  action: 'create_manual' | 'edit' | 'void' | 'restore' | 'request' | 'approve' | 'reject'
  actorUserId?: string
  actorEmployeeId?: string
  actorLabel?: string
  reason?: string
  before?: unknown
  after?: unknown
  createdAt: string
}

// Traduce los códigos de error crudos de las RPC a mensajes legibles.
function friendly(msg: string): string {
  const map: Record<string, string> = {
    MOTIVO_OBLIGATORIO: 'Indica el motivo de la corrección.',
    NO_AUTORIZADO: 'No tienes permiso para corregir fichajes.',
    TIPO_INVALIDO: 'Tipo de fichaje no válido.',
    FICHAJE_NO_EXISTE: 'El fichaje ya no existe.',
    SOLICITUD_NO_EXISTE: 'La solicitud ya no existe.',
    YA_RESUELTA: 'Esta solicitud ya se había resuelto.',
  }
  for (const code of Object.keys(map)) if (msg.includes(code)) return map[code]
  return msg
}

function ensureClient() {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase
}

// Cliente laxo LOCAL (ver DEUDA arriba): evita depender de database.ts para las
// tablas/RPC nuevas. Se retira al regenerar los tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any { return ensureClient() as any }

// ─── Acciones del GESTOR (admin) ──────────────────────────────────────────

/** Alta manual con la HORA que debía ser (cierra "olvidó fichar a las 9:00"). */
export async function addManualClockEntry(
  employeeId: string, type: ClockType, datetimeISO: string, reason: string, actorLabel?: string,
): Promise<void> {
  const { error } = await db().rpc('add_manual_clock_entry', {
    p_employee_id: employeeId, p_type: type, p_datetime: datetimeISO,
    p_reason: reason, p_actor_label: actorLabel ?? null,
  })
  if (error) throw new Error(friendly(error.message))
}

/** Corrige la hora (y/o el tipo) de un fichaje existente; el trigger audita. */
export async function editClockEntry(
  entryId: string, datetimeISO: string, reason: string, type?: ClockType, actorLabel?: string,
): Promise<void> {
  const { error } = await db().rpc('edit_clock_entry', {
    p_entry_id: entryId, p_datetime: datetimeISO, p_reason: reason,
    p_type: type ?? null, p_actor_label: actorLabel ?? null,
  })
  if (error) throw new Error(friendly(error.message))
}

/** Anula un fichaje (borrado lógico, nunca físico). */
export async function voidClockEntry(
  entryId: string, reason: string, actorLabel?: string,
): Promise<void> {
  const { error } = await db().rpc('void_clock_entry', {
    p_entry_id: entryId, p_reason: reason, p_actor_label: actorLabel ?? null,
  })
  if (error) throw new Error(friendly(error.message))
}

/** Resuelve una solicitud del trabajador. Aprobar aplica el cambio auditado y le avisa. */
export async function resolveClockCorrection(
  requestId: string, approve: boolean, note?: string, actorLabel?: string,
): Promise<void> {
  const { error } = await db().rpc('resolve_clock_correction', {
    p_request_id: requestId, p_approve: approve, p_note: note ?? null, p_actor_label: actorLabel ?? null,
  })
  if (error) throw new Error(friendly(error.message))
}

// ─── Acción del TRABAJADOR ────────────────────────────────────────────────

/** El trabajador solicita una corrección (olvido/tardío/error). No aplica nada:
 *  crea una solicitud pendiente que el gestor aprueba o rechaza. */
export async function requestClockCorrection(input: {
  employeeId: string
  requestedByEmployeeId: string
  kind: CorrectionKind
  reason: string
  clockEntryId?: string
  proposedType?: ClockType
  proposedDatetime?: string
}): Promise<void> {
  const { error } = await db().rpc('request_clock_correction', {
    p_employee_id: input.employeeId,
    p_requested_by_employee_id: input.requestedByEmployeeId,
    p_kind: input.kind,
    p_reason: input.reason,
    p_clock_entry_id: input.clockEntryId ?? null,
    p_proposed_type: input.proposedType ?? null,
    p_proposed_datetime: input.proposedDatetime ?? null,
  })
  if (error) throw new Error(friendly(error.message))
}

// ─── Lecturas ─────────────────────────────────────────────────────────────

interface CorrectionRow {
  id: string; account_id: string; employee_id: string; requested_by_employee_id: string
  clock_entry_id: string | null; kind: CorrectionKind; proposed_type: ClockType | null
  proposed_datetime: string | null; reason: string; status: CorrectionStatus
  resolved_by_user_id: string | null; resolved_at: string | null; resolution_note: string | null
  created_at: string
}

function rowToRequest(r: CorrectionRow): ClockCorrectionRequest {
  return {
    id: r.id, accountId: r.account_id, employeeId: r.employee_id,
    requestedByEmployeeId: r.requested_by_employee_id,
    clockEntryId: r.clock_entry_id || undefined, kind: r.kind,
    proposedType: r.proposed_type || undefined, proposedDatetime: r.proposed_datetime || undefined,
    reason: r.reason, status: r.status,
    resolvedByUserId: r.resolved_by_user_id || undefined, resolvedAt: r.resolved_at || undefined,
    resolutionNote: r.resolution_note || undefined, createdAt: r.created_at,
  }
}

/** Solicitudes de corrección (RLS filtra a la cuenta). status opcional. */
export async function fetchCorrectionRequests(status?: CorrectionStatus): Promise<ClockCorrectionRequest[]> {
  let q = db().from('clock_correction_request').select('*').order('created_at', { ascending: false })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) { console.error('fetchCorrectionRequests:', error); return [] }
  return (data as CorrectionRow[]).map(rowToRequest)
}

/** Solicitudes del propio trabajador (para su histórico en MisFichajes). */
export async function fetchMyCorrectionRequests(employeeId: string): Promise<ClockCorrectionRequest[]> {
  const { data, error } = await db()
    .from('clock_correction_request')
    .select('*')
    .eq('requested_by_employee_id', employeeId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchMyCorrectionRequests:', error); return [] }
  return (data as CorrectionRow[]).map(rowToRequest)
}

interface AuditRow {
  id: string; clock_entry_id: string | null; employee_id: string | null; account_id: string | null
  action: ClockEntryAudit['action']; actor_user_id: string | null; actor_employee_id: string | null
  actor_label: string | null; reason: string | null; before: unknown; after: unknown; created_at: string
}

/** Rastro completo de un fichaje (para "ver historial de cambios"). */
export async function fetchClockAudit(clockEntryId: string): Promise<ClockEntryAudit[]> {
  const { data, error } = await db()
    .from('clock_entry_audit')
    .select('*')
    .eq('clock_entry_id', clockEntryId)
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchClockAudit:', error); return [] }
  return (data as AuditRow[]).map((r: AuditRow) => ({
    id: r.id, clockEntryId: r.clock_entry_id || undefined, employeeId: r.employee_id || undefined,
    accountId: r.account_id || undefined, action: r.action,
    actorUserId: r.actor_user_id || undefined, actorEmployeeId: r.actor_employee_id || undefined,
    actorLabel: r.actor_label || undefined, reason: r.reason || undefined,
    before: r.before, after: r.after, createdAt: r.created_at,
  }))
}
