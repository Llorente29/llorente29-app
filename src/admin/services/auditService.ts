// src/admin/services/auditService.ts
//
// Service de lectura del registro de auditoría de plataforma (Portal de staff).
//
// Lee vía RPC list_platform_events (SECURITY DEFINER, valida platform_admin y
// resuelve nombres en SQL). La pantalla solo pinta; no hace joins ni N+1.
//
// El registro es de SOLO LECTURA desde la app (inmutable por trigger en BBDD).
// La escritura la hacen el trigger de estado y el RPC log_platform_event.

import { supabase } from '../../lib/supabase'
import { listAccounts } from '@/modules/multitenancy/services/accountsService'

export interface AuditEvent {
  id: string
  createdAt: string
  eventType: string
  adminId: string | null
  adminName: string | null
  adminEmail: string | null
  targetAccountId: string | null
  accountName: string | null
  targetUserId: string | null
  details: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  totalCount: number
}

export interface AuditFilters {
  accountId?: string | null
  adminId?: string | null
  eventType?: string | null
  from?: string | null      // ISO date/datetime
  to?: string | null
  limit?: number
  offset?: number
}

// Etiquetas legibles sobre las claves estables del CHECK (las claves NO cambian).
const EVENT_LABELS: Record<string, string> = {
  account_created:          'Cuenta creada',
  account_status_changed:   'Estado de cuenta cambiado',
  account_modules_changed:  'Módulos cambiados',
  account_suspended:        'Cuenta suspendida',
  account_unsuspended:      'Cuenta reactivada',
  account_archived:         'Cuenta archivada',
  account_unarchived:       'Cuenta desarchivada',
  account_deleted:          'Cuenta eliminada',
  account_restored:         'Cuenta restaurada',
  impersonation_started:    'Impersonación iniciada',
  impersonation_ended:      'Impersonación finalizada',
  admin_created:            'Admin creado',
  admin_suspended:          'Admin suspendido',
  admin_reactivated:        'Admin reactivado',
  admin_2fa_reset:          'Reset 2FA de admin',
  admin_permissions_changed:'Permisos de admin cambiados',
  seed_data_modified:       'Datos semilla modificados',
  system_config_changed:    'Configuración del sistema cambiada',
  global_notification_sent: 'Notificación global enviada',
  permission_set_modified:  'Conjunto de permisos modificado',
}

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType
}

/** Lista de tipos de evento conocidos (para el filtro), con su etiqueta. */
export function knownEventTypes(): { value: string; label: string }[] {
  return Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }))
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/**
 * Lee los eventos de auditoría aplicando filtros. Devuelve las filas mapeadas
 * y el total (para paginación). El total viene en cada fila (total_count).
 */
export async function listAuditEvents(
  filters: AuditFilters = {},
): Promise<{ events: AuditEvent[]; total: number }> {
  const sb = requireSupabase()
  const { data, error } = await sb.rpc('list_platform_events', {
    p_account_id: filters.accountId ?? undefined,
    p_admin_id: filters.adminId ?? undefined,
    p_event_type: filters.eventType ?? undefined,
    p_from: filters.from ?? undefined,
    p_to: filters.to ?? undefined,
    p_limit: filters.limit ?? 100,
    p_offset: filters.offset ?? 0,
  })
  if (error) throw new Error(`Error leyendo auditoría: ${error.message}`)

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const events: AuditEvent[] = rows.map(r => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    eventType: r.event_type as string,
    adminId: (r.admin_id as string) ?? null,
    adminName: (r.admin_name as string) ?? null,
    adminEmail: (r.admin_email as string) ?? null,
    targetAccountId: (r.target_account_id as string) ?? null,
    accountName: (r.account_name as string) ?? null,
    targetUserId: (r.target_user_id as string) ?? null,
    details: (r.details as Record<string, unknown>) ?? null,
    ipAddress: (r.ip_address as string) ?? null,
    userAgent: (r.user_agent as string) ?? null,
    totalCount: Number(r.total_count ?? 0),
  }))
  const total = events.length > 0 ? events[0].totalCount : 0
  return { events, total }
}

/** Opciones de filtro: cuentas (para el desplegable). */
export async function getAccountFilterOptions(): Promise<{ id: string; name: string }[]> {
  const accounts = await listAccounts({ includeInternal: true })
  return accounts.map(a => ({ id: a.id, name: a.name }))
}

/** Resumen legible del detalle de un evento (para la columna "Detalle"). */
export function summarizeDetails(ev: AuditEvent): string {
  const d = ev.details
  if (!d) return ''
  if (ev.eventType === 'account_status_changed') {
    return `${d.from ?? '?'} → ${d.to ?? '?'}`
  }
  if (ev.eventType === 'account_modules_changed') {
    const act = Array.isArray(d.activated) ? (d.activated as string[]) : []
    const deact = Array.isArray(d.deactivated) ? (d.deactivated as string[]) : []
    const parts: string[] = []
    if (act.length) parts.push(`+${act.join(', ')}`)
    if (deact.length) parts.push(`−${deact.join(', ')}`)
    return parts.join('  ')
  }
  // Genérico: compacta el jsonb.
  try {
    return Object.entries(d).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
  } catch {
    return ''
  }
}

/** Exporta los eventos dados a CSV (cliente). */
export function exportEventsCsv(events: AuditEvent[]): void {
  const header = ['fecha', 'evento', 'admin', 'email_admin', 'cuenta', 'detalle', 'ip', 'user_agent']
  const escape = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`
  const lines = events.map(ev => [
    ev.createdAt,
    eventLabel(ev.eventType),
    ev.adminName ?? '',
    ev.adminEmail ?? '',
    ev.accountName ?? '',
    summarizeDetails(ev),
    ev.ipAddress ?? '',
    ev.userAgent ?? '',
  ].map(v => escape(String(v))).join(','))

  const csv = [header.join(','), ...lines].join('\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `auditoria_folvy_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
