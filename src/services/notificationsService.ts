// src/services/notificationsService.ts
// Notificaciones in-app para trabajadores.
// Se rellenan desde varios eventos (cierre de periodo, vacaciones aprobadas, etc.)
// El trabajador las ve en su app móvil con una campana 🔔.

import { supabase } from '../lib/supabase'

export type NotificationType =
  | 'period_closed'        // Cierre de periodo de bolsa de horas
  | 'vacation_approved'    // Vacación/ausencia aprobada
  | 'vacation_rejected'    // Vacación/ausencia rechazada
  | 'schedule_published'   // Nuevo horario semanal disponible
  | 'shift_swap_request'   // Petición de cambio de turno
  | 'generic'              // Genérica (admin, anuncios, etc.)

export interface EmployeeNotification {
  id: string
  employeeId: string
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  read: boolean
  createdAt: string
  readAt?: string
}

interface NotificationRow {
  id: string
  employee_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown> | null
  read: boolean
  created_at: string
  read_at: string | null
}

function rowToNotification(r: NotificationRow): EmployeeNotification {
  return {
    id: r.id,
    employeeId: r.employee_id,
    type: r.type as NotificationType,
    title: r.title,
    body: r.body,
    data: r.data || undefined,
    read: r.read,
    createdAt: r.created_at,
    readAt: r.read_at || undefined,
  }
}

/**
 * Crear una notificación para un empleado
 */
export async function createNotification(
  employeeId: string,
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<EmployeeNotification | null> {
  if (!supabase) return null
  const { data: row, error } = await supabase
    .from('employee_notifications')
    .insert({
      employee_id: employeeId,
      type,
      title,
      body,
      data: data || null,
    })
    .select()
    .single()
  if (error) {
    console.error('[notifications] createNotification:', error)
    return null
  }
  return rowToNotification(row as NotificationRow)
}

/**
 * Crear notificaciones para múltiples empleados de golpe.
 * Útil cuando se cierra un periodo para todo un local.
 */
export async function createNotificationsForEmployees(
  employeeIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<number> {
  if (!supabase) return 0
  if (employeeIds.length === 0) return 0
  const rows = employeeIds.map(id => ({
    employee_id: id,
    type,
    title,
    body,
    data: data || null,
  }))
  const { error, count } = await supabase
    .from('employee_notifications')
    .insert(rows, { count: 'exact' })
  if (error) {
    console.error('[notifications] createNotificationsForEmployees:', error)
    return 0
  }
  return count || rows.length
}

/**
 * Obtener notificaciones de un empleado (más recientes primero).
 * Por defecto solo las últimas 30.
 */
export async function fetchNotifications(
  employeeId: string,
  options?: { onlyUnread?: boolean; limit?: number }
): Promise<EmployeeNotification[]> {
  if (!supabase) return []
  const limit = options?.limit ?? 30
  let query = supabase
    .from('employee_notifications')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (options?.onlyUnread) {
    query = query.eq('read', false)
  }
  const { data, error } = await query
  if (error) {
    console.error('[notifications] fetchNotifications:', error)
    return []
  }
  return (data || []).map(r => rowToNotification(r as NotificationRow))
}

/**
 * Contar notificaciones no leídas de un empleado.
 * Es ligero (no devuelve los datos, solo el count).
 */
export async function countUnread(employeeId: string): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('employee_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('employee_id', employeeId)
    .eq('read', false)
  if (error) {
    console.error('[notifications] countUnread:', error)
    return 0
  }
  return count || 0
}

/**
 * Marcar una notificación como leída
 */
export async function markAsRead(notificationId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('employee_notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) {
    console.error('[notifications] markAsRead:', error)
    return false
  }
  return true
}

/**
 * Marcar todas las notificaciones de un empleado como leídas
 */
export async function markAllAsRead(employeeId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('employee_notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('employee_id', employeeId)
    .eq('read', false)
  if (error) {
    console.error('[notifications] markAllAsRead:', error)
    return false
  }
  return true
}

/**
 * Borrar una notificación
 */
export async function deleteNotification(notificationId: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('employee_notifications')
    .delete()
    .eq('id', notificationId)
  if (error) {
    console.error('[notifications] deleteNotification:', error)
    return false
  }
  return true
}
