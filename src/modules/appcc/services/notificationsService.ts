// src/services/notificationsService.ts
// Servicio genérico de notificaciones in-app.
// Inserta filas en appcc_notifications (reutilizable para todos los módulos).
// Cuando sendEmail=true, llama a una Edge Function de Supabase (opcional).

import { supabase } from '@/lib/supabase'
import type {
  AppccNotification,
  AppccNotificationSeverity,
} from '@/modules/appcc/types'

export interface CreateNotificationInput {
  accountId: string
  userId: string
  type: string
  title: string
  body?: string | null
  linkType?: string | null
  linkId?: string | null
  severity?: AppccNotificationSeverity
  sendEmail?: boolean
}

/**
 * Crea una notificación in-app para un usuario.
 * Si sendEmail=true, dispara también un email (mejor esfuerzo, no bloquea).
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<AppccNotification | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('appcc_notifications')
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link_type: input.linkType ?? null,
      link_id: input.linkId ?? null,
      severity: input.severity ?? 'info',
    })
    .select()
    .single()

  if (error) {
    console.error('[notificationsService] createNotification error', error)
    return null
  }

  const notif = data as AppccNotification

  if (input.sendEmail) {
    // No await: best-effort, no bloquea la UI
    void sendEmail(notif).catch(err =>
      console.warn('[notificationsService] sendEmail failed (non-blocking)', err)
    )
  }

  return notif
}

/**
 * Lista las notificaciones del usuario actual (últimas 50).
 */
export async function listMyNotifications(
  limit = 50
): Promise<AppccNotification[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('appcc_notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[notificationsService] listMyNotifications error', error)
    return []
  }
  return (data ?? []) as AppccNotification[]
}

/**
 * Cuenta no leídas del usuario actual.
 */
export async function countUnread(): Promise<number> {
  if (!supabase) return 0
  const { count, error } = await supabase
    .from('appcc_notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) {
    console.error('[notificationsService] countUnread error', error)
    return 0
  }
  return count ?? 0
}

/**
 * Marca como leídas.
 */
export async function markAsRead(notificationIds: string[]): Promise<void> {
  if (!supabase || notificationIds.length === 0) return
  const { error } = await supabase
    .from('appcc_notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', notificationIds)
  if (error) {
    console.error('[notificationsService] markAsRead error', error)
  }
}

export async function markAllAsRead(): Promise<void> {
  if (!supabase) return
  const { error } = await supabase
    .from('appcc_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
  if (error) {
    console.error('[notificationsService] markAllAsRead error', error)
  }
}

// ============================================================
// EMAIL (vía Supabase Edge Function — opcional)
// ============================================================

/**
 * Dispara el envío de email vía Edge Function 'send-notification-email'.
 * Si la function no existe aún, falla silenciosamente y se loguea warn.
 *
 * Para activar el envío real, crea en Supabase:
 *   supabase/functions/send-notification-email/index.ts
 * con integración a Resend / SendGrid / SES.
 */
async function sendEmail(notif: AppccNotification): Promise<void> {
  if (!supabase) return

  try {
    const { error } = await supabase.functions.invoke('send-notification-email', {
      body: {
        notification_id: notif.id,
        user_id: notif.user_id,
        title: notif.title,
        body: notif.body,
        link_type: notif.link_type,
        link_id: notif.link_id,
        severity: notif.severity,
      },
    })

    if (error) {
      console.warn('[notificationsService] sendEmail edge function error', error)
      return
    }

    // Marcar email_sent
    await supabase
      .from('appcc_notifications')
      .update({ email_sent: true, email_sent_at: new Date().toISOString() })
      .eq('id', notif.id)
  } catch (err) {
    console.warn('[notificationsService] sendEmail caught', err)
  }
}
