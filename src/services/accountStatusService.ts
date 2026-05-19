// src/services/accountStatusService.ts
//
// Wrapper sobre la Edge Function `check-account-status` (Sprint 2 Bloque A2).
// Invocada por LoginPage tras un signInWithPassword exitoso.
//
// Endpoint:  POST /functions/v1/check-account-status
// Auth:      JWT obligatorio (verify_jwt=true en config.toml)
// Body:      {} (no requiere payload, lee del JWT)
// Response:  { status, redirect_to, message }
//
// La función decide el redirect post-login en base a los claims `folvy.*`
// que `custom_access_token_hook` (Bloque A1) inyecta en el JWT.

import { supabase } from '../lib/supabase'

/* =====================================================
   Tipos
   ===================================================== */

export type AccountStatus =
  | 'ok'
  | 'no_active_profile'
  | 'all_accounts_suspended'
  | 'all_accounts_deleted'

export interface CheckAccountStatusResponse {
  status: AccountStatus
  redirect_to: string | null
  message: string | null
}

/* =====================================================
   Helper interno: URL base de Supabase
   ===================================================== */

/**
 * Construye la URL base de Functions desde VITE_SUPABASE_URL.
 *
 * Patrón:
 *   VITE_SUPABASE_URL  = https://xxxxx.supabase.co
 *   Functions base URL = https://xxxxx.supabase.co/functions/v1
 */
function getFunctionsBaseUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) {
    throw new Error(
      'VITE_SUPABASE_URL no configurado. Edge Functions no disponibles.'
    )
  }
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1`
}

/* =====================================================
   API pública
   ===================================================== */

/**
 * Llama a la Edge Function check-account-status para resolver el redirect
 * post-login basado en el estado de las cuentas del user.
 *
 * Requisitos:
 *   - Sesión Supabase activa (el JWT actual se lee de supabase.auth.getSession()).
 *   - Hook custom_access_token_hook activo (claims folvy.* presentes).
 *
 * Casos de respuesta status=200:
 *   - 'ok'                     → redirect_to válido, navegar a esa ruta.
 *   - 'no_active_profile'      → user sin profiles activos NI platform_admin.
 *                                Frontend debe mostrar mensaje + signOut().
 *   - 'all_accounts_suspended' → todas las cuentas suspendidas.
 *   - 'all_accounts_deleted'   → todas las cuentas borradas.
 *
 * En caso de error técnico (sin sesión, network error, 5xx) lanza Error.
 * El caller debe envolver en try/catch.
 */
export async function checkAccountStatus(): Promise<CheckAccountStatusResponse> {
  if (!supabase) {
    throw new Error('Supabase no configurado')
  }

  // Obtener access_token actual de la sesión
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession()

  if (sessionError) {
    throw new Error(`No se pudo obtener sesión: ${sessionError.message}`)
  }

  const accessToken = sessionData.session?.access_token
  if (!accessToken) {
    throw new Error(
      'No hay sesión Supabase activa. Llama a signInWithPassword primero.'
    )
  }

  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!anonKey) {
    throw new Error('VITE_SUPABASE_ANON_KEY no configurado')
  }

  // POST a la Edge Function
  const url = `${getFunctionsBaseUrl()}/check-account-status`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  } catch (e) {
    // Network error (offline, DNS, CORS antes del response, etc.)
    throw new Error(
      `Error de red llamando a check-account-status: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
  }

  // Parsear respuesta
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(
      `check-account-status devolvió respuesta no-JSON (status ${response.status})`
    )
  }

  if (!response.ok) {
    // 4xx/5xx con body JSON
    const errorMsg =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${response.status}`
    throw new Error(`check-account-status falló: ${errorMsg}`)
  }

  // Validación mínima de shape del body
  if (
    typeof body !== 'object' ||
    body === null ||
    !('status' in body) ||
    !('redirect_to' in body) ||
    !('message' in body)
  ) {
    throw new Error('check-account-status devolvió shape inesperado')
  }

  return body as CheckAccountStatusResponse
}
