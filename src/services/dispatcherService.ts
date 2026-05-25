// src/services/dispatcherService.ts
//
// Despachador multi-canal de comunicaciones. Capa SUPERIOR a notificationsService
// (NO lo sustituye — los 6 consumidores legacy siguen llamando directo a
// createNotification / createNotificationsForEmployees para casos single-channel).
//
// Diseño Fase A (bloque multi-canal, mayo 2026):
//   - dispatch(event, recipients, channels): orquesta envío por uno o varios canales.
//   - Canal 'in_app': implementado vía notificationsService.createNotificationsForEmployees.
//   - Canal 'email':  implementado en Fase B (B.6) vía accountEmailService.sendAccountMessage
//                     + Edge Function account-email.
//
// El caller decide los canales explícitamente. El dispatcher NO infiere ni
// consulta preferencias de usuario (eso es Fase C futura), NO consulta la BBDD
// y NO depende de React.
//
// B.6 (opción A): `accountId` vive en DispatchEvent. Un evento de comunicación
// ocurre SIEMPRE en una cuenta concreta; el canal email lo exige (lo valida
// server-side) y el in-app escribe en employee_notifications que son de cuenta.
// Ponerlo en el tipo lo hace autodescriptivo y el compilador obliga a rellenarlo,
// sin la fragilidad de un parámetro posicional extra (cf. regla v17.1).

import * as notificationsService from './notificationsService'
import { sendAccountMessage } from './accountEmailService'

// ─── Tipos públicos ────────────────────────────────────────────────────────

export type Channel = 'in_app' | 'email'

export interface DispatchEvent {
  /** Cuenta en la que ocurre el evento. Requerido. El canal email lo valida
   *  server-side contra las cuentas del caller; el in-app lo usa implícitamente
   *  vía los employee_notifications de los destinatarios. */
  accountId: string
  /** Identificador semántico del evento. Va en `data.kind` de la notificación. */
  kind: string
  title: string
  body: string
  /** Datos extra que se mezclan en `data` del registro persistido in-app.
   *  Para el canal email, si se incluye `senderName` (string) se pasa a la
   *  plantilla del correo; el dispatcher NO resuelve el nombre por su cuenta
   *  (no consulta BBDD). */
  extra?: Record<string, unknown>
  /** employee_id del remitente. null/undefined = sistema (default).
   *  La policy INSERT de RLS valida que sea NULL o el del propio caller o
   *  admin de la cuenta destinataria. */
  senderEmployeeId?: string | null
}

export interface DispatchRecipient {
  employeeId: string
  /** Email del empleado. Informativo para el canal email; el server recalcula
   *  el to_email real desde employees.email (fail-closed). */
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
 *   - Email es BEST-EFFORT vía accountEmailService (Fase B): nunca lanza; un
 *     fallo global (rate limit, permiso, etc.) cuenta todos los recipients como
 *     failed. Los recipients sin email se cuentan como skipped y no se envían.
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

  // ─── Canal EMAIL (Fase B — B.6) ──────────────────────────────────────────
  // Llama a accountEmailService.sendAccountMessage con los recipients que tienen
  // email. Los que NO tienen email se cuentan como skipped (no se envían; el
  // server los rechazaría fail-closed de todos modos). El wrapper es best-effort:
  // si devuelve ok:false (rate limit, forbidden, validación...), todos los
  // recipients enviados cuentan como failed.
  if (channels.includes('email')) {
    const emailRecipients = recipients.filter(r => r.email)
    result.email.skipped = recipients.length - emailRecipients.length

    if (emailRecipients.length > 0) {
      // senderName: solo si el caller lo pasó explícitamente en extra. El
      // dispatcher NO resuelve nombres (no consulta BBDD).
      const senderName =
        typeof event.extra?.senderName === 'string'
          ? (event.extra.senderName as string)
          : undefined

      const res = await sendAccountMessage(
        event.accountId,
        emailRecipients.map(r => ({ employeeId: r.employeeId, email: r.email })),
        {
          title: event.title,
          body: event.body,
          ...(senderName ? { senderName } : {}),
        },
      )

      if (res.ok) {
        // sent/failed vienen del server; si no los reporta, asumimos todo enviado.
        const sent = res.sent ?? emailRecipients.length
        const failed = res.failed ?? 0
        result.email.delivered = sent
        result.email.failed = failed
      } else {
        // Fallo global del envío: ningún email salió → todos failed.
        result.email.delivered = 0
        result.email.failed = emailRecipients.length
      }
    }
  }

  return result
}
