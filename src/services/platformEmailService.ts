// src/services/platformEmailService.ts
//
// Wrapper de cliente sobre la Edge Function `send-email` (Sesión 17, Bloque 1).
// Dispara correos de plataforma (avisos de portería, etc.) usando el JWT
// de platform_admin de la sesión actual.
//
// Endpoint:  POST /functions/v1/send-email
// Auth:      JWT de platform_admin (la Edge Function valida is_platform_admin).
// Body:      { to, template, data }
// Response:  { status: 'ok', email_id } | { error, detail? }
//
// DISEÑO BEST-EFFORT: estas funciones NO lanzan. Devuelven un resultado
// { ok, emailId?, error? } para que el caller decida. El envío de email es
// SECUNDARIO frente a la operación principal (p. ej. cambiar el estado de una
// cuenta): si el correo falla, la operación principal no debe romperse.
// El caller típico (setAccountStatus) ignora el fallo salvo para loguearlo.

import { supabase } from '../lib/supabase'

/* =====================================================
   Tipos
   ===================================================== */

export interface SendPlatformEmailResult {
  ok: boolean
  emailId?: string | null
  error?: string
}

/* =====================================================
   Helper interno: URL base de Functions
   ===================================================== */

function getFunctionsBaseUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL no configurado. Edge Functions no disponibles.')
  }
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`
}

/* =====================================================
   API pública
   ===================================================== */

/**
 * Envía un correo de plataforma a través de la Edge Function `send-email`.
 *
 * BEST-EFFORT: no lanza nunca. Devuelve { ok:false, error } ante cualquier
 * problema (sin sesión, red, 4xx/5xx, Resend rechaza...). El caller decide
 * qué hacer con el fallo (típicamente: loguear y continuar).
 *
 * @param to        Email destino.
 * @param template  Nombre de plantilla registrada en la Edge Function.
 * @param data      Datos para la plantilla (opcional).
 */
export async function sendPlatformEmail(
  to: string,
  template: string,
  data: Record<string, unknown> = {},
): Promise<SendPlatformEmailResult> {
  try {
    if (!supabase) {
      return { ok: false, error: 'Supabase no configurado' }
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) {
      return { ok: false, error: `No se pudo obtener sesión: ${sessionError.message}` }
    }
    const accessToken = sessionData.session?.access_token
    if (!accessToken) {
      return { ok: false, error: 'No hay sesión activa' }
    }

    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
    if (!anonKey) {
      return { ok: false, error: 'VITE_SUPABASE_ANON_KEY no configurado' }
    }

    const url = `${getFunctionsBaseUrl()}/send-email`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, template, data }),
    })

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return { ok: false, error: `send-email devolvió respuesta no-JSON (status ${response.status})` }
    }

    if (!response.ok) {
      const msg =
        typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${response.status}`
      return { ok: false, error: msg }
    }

    const emailId =
      typeof body === 'object' && body !== null && 'email_id' in body
        ? ((body as { email_id: unknown }).email_id as string | null)
        : null

    return { ok: true, emailId }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
