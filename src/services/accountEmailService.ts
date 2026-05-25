// src/services/accountEmailService.ts
//
// B.5 — Wrapper cliente sobre la Edge Function `account-email`.
//
// Envía un mensaje de email de CUENTA (manager -> empleado/s) a través de la
// Edge Function `account-email`, que verifica el JWT criptograficamente
// (supabase.auth.getUser) y valida server-side que el caller es admin/manager
// de la cuenta indicada.
//
// CONTRATO con la Edge Function (account-email/index.ts):
//   POST {functionsBase}/account-email
//   Headers: apikey, Authorization: Bearer <jwt-del-usuario>, Content-Type
//   Body (AccountEmailPayload):
//     {
//       accountId: string;                                   // requerido
//       recipients: { employeeId: string; email?: string }[] // 1..50
//       template: 'account_message';
//       data: { title: string; body: string; senderName?: string };
//     }
//   Respuestas: 200 {status:'ok', sent, failed} | 400 | 401 | 403 | 429 | 405 | 500.
//
// NOTAS:
//   - `recipients[].email` se ACEPTA pero el server lo IGNORA: `to_email` se
//     recalcula server-side desde `employees.email` (fail-closed). Lo pasamos
//     igualmente para que la UI no tenga que hacer round-trip al mostrarlo.
//   - `accountId` DEBE ser el `activeAccountId` del AppContext (lo pasa el
//     caller; este service NO lee React). Fail-closed si llega vacío.
//   - Rate limit estricto server-side: 50/h, 200/dia por cuenta. El 429 es
//     opaco (no filtra el limite numerico); aqui se mapea a un `code` legible.
//
// Patron espejo: src/services/platformEmailService.ts (best-effort, NO lanza,
// fetch directo en vez de supabase.functions.invoke). Aqui se mantiene el
// "NO lanza" pero se enriquece el retorno con un `code` para que la UI (B.7)
// pueda reaccionar distinto a permiso/limite/validacion sin parsear texto.

import { supabase } from '../lib/supabase'

// ── Tipos del contrato ──────────────────────────────────────────────────────

export interface AccountMessageRecipient {
  employeeId: string
  // Solo informativo para la UI; el server recalcula el email real.
  email?: string | null
}

export interface AccountMessageData {
  title: string
  body: string
  senderName?: string
}

// Codigo estable para que la UI decida el mensaje al usuario.
//   'ok'            -> envio aceptado (revisar sent/failed)
//   'not_configured'-> no hay cliente Supabase (modo localStorage)
//   'no_session'    -> no hay sesion / JWT (usuario no logueado)
//   'no_account'    -> accountId vacio (fail-closed)
//   'bad_request'   -> 400 validacion de payload
//   'unauthorized'  -> 401 JWT invalido
//   'forbidden'     -> 403 no admin/manager, cross-tenant, o recipient invalido
//   'rate_limited'  -> 429 limite de envios alcanzado
//   'server_error'  -> 5xx u otro fallo no clasificado
//   'network_error' -> fetch fallo / respuesta no parseable
export type AccountMessageCode =
  | 'ok'
  | 'not_configured'
  | 'no_session'
  | 'no_account'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'server_error'
  | 'network_error'

export interface SendAccountMessageResult {
  ok: boolean
  code: AccountMessageCode
  sent?: number
  failed?: number
  error?: string
}

// ── Helpers internos ─────────────────────────────────────────────────────────

function getFunctionsBaseUrl(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!url) return null
  // Quita la barra final si la hubiera y concatena la ruta de functions.
  return `${url.replace(/\/$/, '')}/functions/v1`
}

function mapStatusToCode(status: number): AccountMessageCode {
  if (status === 400) return 'bad_request'
  if (status === 401) return 'no_session' // JWT ausente/invalido a nivel app
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'server_error'
}

function humanError(code: AccountMessageCode): string {
  switch (code) {
    case 'not_configured':
      return 'Servicio de correo no configurado.'
    case 'no_session':
      return 'Tu sesión ha caducado. Vuelve a iniciar sesión.'
    case 'no_account':
      return 'No hay una cuenta activa seleccionada.'
    case 'bad_request':
      return 'El mensaje no es válido. Revisa el asunto y el cuerpo.'
    case 'unauthorized':
      return 'No tienes autorización para enviar este mensaje.'
    case 'forbidden':
      return 'No tienes permiso para enviar mensajes en esta cuenta.'
    case 'rate_limited':
      return 'Has alcanzado el límite de envíos. Inténtalo más tarde.'
    case 'server_error':
      return 'Error del servidor de correo. Inténtalo más tarde.'
    case 'network_error':
      return 'No se pudo contactar con el servidor de correo.'
    default:
      return 'No se pudo enviar el mensaje.'
  }
}

// ── API publica ──────────────────────────────────────────────────────────────

/**
 * Envia un mensaje de email de cuenta (manager -> empleados) via Edge Function
 * `account-email`. Best-effort: NUNCA lanza; los fallos vuelven en el resultado.
 *
 * @param accountId  UUID de la cuenta activa (activeAccountId del AppContext).
 *                   Requerido; fail-closed si viene vacio.
 * @param recipients 1..50 destinatarios por employeeId.
 * @param data       { title (1..200), body (1..5000), senderName? }.
 */
export async function sendAccountMessage(
  accountId: string,
  recipients: AccountMessageRecipient[],
  data: AccountMessageData,
): Promise<SendAccountMessageResult> {
  // 1. Guard: cliente Supabase disponible.
  if (!supabase) {
    return { ok: false, code: 'not_configured', error: humanError('not_configured') }
  }

  // 2. Guard: accountId presente (fail-closed; no confiar en el caller).
  if (!accountId) {
    return { ok: false, code: 'no_account', error: humanError('no_account') }
  }

  // 3. Guard: hay destinatarios.
  if (!recipients || recipients.length === 0) {
    return { ok: false, code: 'bad_request', error: 'No hay destinatarios.' }
  }

  // 4. Obtener JWT de la sesion actual.
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    return { ok: false, code: 'no_session', error: humanError('no_session') }
  }

  // 5. Resolver URL de functions y anon key.
  const base = getFunctionsBaseUrl()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!base || !anonKey) {
    return { ok: false, code: 'not_configured', error: humanError('not_configured') }
  }

  // 6. Construir payload casado con AccountEmailPayload de la Edge Function.
  const payload = {
    accountId,
    recipients: recipients.map((r) => ({
      employeeId: r.employeeId,
      // Informativo; el server lo ignora y recalcula desde employees.email.
      ...(r.email ? { email: r.email } : {}),
    })),
    template: 'account_message' as const,
    data: {
      title: data.title,
      body: data.body,
      ...(data.senderName ? { senderName: data.senderName } : {}),
    },
  }

  // 7. Invocar (fetch directo, no functions.invoke; coherente con el patron
  //    espejo y con como account-email valida el JWT del header).
  let response: Response
  try {
    response = await fetch(`${base}/account-email`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, code: 'network_error', error: humanError('network_error') }
  }

  // 8. Parsear respuesta (defensivo: puede no ser JSON en algunos 5xx).
  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    // Respuesta sin cuerpo JSON: clasificar por status.
    if (response.ok) {
      // 200 sin cuerpo parseable: lo damos por enviado sin detalle.
      return { ok: true, code: 'ok' }
    }
    const code = mapStatusToCode(response.status)
    return { ok: false, code, error: humanError(code) }
  }

  // 9. Camino feliz: 200 con { status: 'ok', sent, failed }.
  if (response.ok) {
    const bodyObj = (parsed ?? {}) as Record<string, unknown>
    const sent = typeof bodyObj.sent === 'number' ? bodyObj.sent : undefined
    const failed = typeof bodyObj.failed === 'number' ? bodyObj.failed : undefined
    return { ok: true, code: 'ok', sent, failed }
  }

  // 10. Error: mapear status -> code, y usar el `error` del server si lo trae.
  const code = mapStatusToCode(response.status)
  const bodyObj = (parsed ?? {}) as Record<string, unknown>
  const serverError =
    typeof bodyObj.error === 'string' ? bodyObj.error : humanError(code)
  return { ok: false, code, error: serverError }
}
