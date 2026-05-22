// src/services/dispatcherService.ts
//
// Despachador multi-canal de comunicaciones. Capa SUPERIOR a notificationsService
// (NO lo sustituye — los 6 consumidores legacy siguen llamando directo a
// createNotification / createNotificationsForEmployees para casos single-channel).
//
// Diseño Fase A (bloque multi-canal, mayo 2026):
//   - dispatch(event, recipients, channels): orquesta envío por uno o varios canales.
//   - Canal 'in_app': implementado vía notificationsService.createNotificationsForEmployees.
//   - Canal 'email':  STUB en Fase A (se cuenta como skipped, NO envía). La
//                     implementación real entra en Fase B con accountEmailService
//                     + Edge Function account-email.
//
// El caller decide los canales explícitamente. El dispatcher NO infiere ni
// consulta preferencias de usuario (eso es Fase C futura).

import * as notificationsService from './notificationsService'

// ─── Tipos públicos ────────────────────────────────────────────────────────

export type Channel = 'in_app' | 'email'

export interface DispatchEvent {
  /** Identificador semántico del evento. Va en `data.kind` de la notificación. */
  kind: string
  title: string
  body: string
  /** Datos extra que se mezclan en `data` del registro persistido. */
  extra?: Record<string, unknown>
  /** employee_id del remitente. null/undefined = sistema (default).
   *  La policy INSERT de RLS valida que sea NULL o el del propio caller o
   *  admin de la cuenta destinataria. */
  senderEmployeeId?: string | null
}

export interface DispatchRecipient {
  employeeId: string
  /** Email del empleado. Si está y 'email' ∈ channels, se manda email (Fase B). */
  email?: string | null
}

export interface DispatchResult {
  inApp: { delivered: number; failed: number }
  email: { delivered: number; failed: number; skipped: number }
}

// ─── API pública ───────────────────────────────────────────────────────────

/**
 * Despacha un evento a uno o varios destinatarios por uno o varios canales.
 *
 * Reglas:
 *   - El caller decide los canales (sin inferencia automática).
 *   - In-app es BEST-EFFORT vía notificationsService (los fallos parciales se
 *     reflejan en result.inApp.failed; nunca lanza).
 *   - Email es STUB en Fase A: todo recipient cuenta como skipped, no envía.
 *   - Si no se pide ningún canal, devuelve resultado vacío (no es error).
 *   - Si recipients está vacío, devuelve resultado vacío.
 *
 * @returns Conteos por canal. Nunca lanza — errores se reflejan en el resultado.
 */
export async function dispatch(
  event: DispatchEvent,
  recipients: DispatchRecipient[],
  channels: Channel[],
): Promise<DispatchResult> {
  const result: DispatchResult = {
    inApp: { delivered: 0, failed: 0 },
    email: { delivered: 0, failed: 0, skipped: 0 },
  }

  if (recipients.length === 0 || channels.length === 0) {
    return result
  }

  // ─── Canal IN-APP ────────────────────────────────────────────────────────
  if (channels.includes('in_app')) {
    const ids = recipients.map(r => r.employeeId)
    // Orden importante: extra primero, kind del evento DESPUÉS para que gane
    // (si el caller mete extra.kind, lo ignoramos en favor del declarado).
    const data = { ...(event.extra ?? {}), kind: event.kind }
    // createNotificationsForEmployees devuelve el count REAL de filas insertadas.
    // Si RLS rechaza alguna (raro), la diferencia entra como 'failed'.
    const delivered = await notificationsService.createNotificationsForEmployees(
      ids,
      'generic',                             // type fijo: kind real va en data
      event.title,
      event.body,
      data,
      event.senderEmployeeId ?? null,        // sexto arg posicional (regla v17.1)
    )
    result.inApp.delivered = delivered
    result.inApp.failed = Math.max(0, ids.length - delivered)
  }

  // ─── Canal EMAIL (STUB Fase A) ───────────────────────────────────────────
  // En Fase B este bloque llamará a accountEmailService.sendAccountMessage()
  // con los recipients que tengan email. Por ahora, todos cuentan como skipped.
  if (channels.includes('email')) {
    result.email.skipped = recipients.length
  }

  return result
}
